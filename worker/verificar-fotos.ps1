# Verifica a descricao de fotos (POST /descrever) no Worker publicado, com o Gemini a sério.
# Gera uma imagem de teste com texto, pede a descricao sem guardar e depois guardando
# (fica fotos/verificacao0/1.jpg no garagem-dados; podes apagar o ficheiro no site do GitHub).
# Correr: powershell -ExecutionPolicy Bypass -File worker\verificar-fotos.ps1

$W = 'https://api-github-garagem-dados.rmleston.workers.dev'
$s = Read-Host -AsSecureString 'PAI_KEY ou ADMIN_KEY (nao aparece no ecra)'
$chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$h = @{ Origin = 'https://r-lst.github.io'; Authorization = "Bearer $chave" }
$falhas = 0
function Ok($c, $m) { if ($c) { Write-Host "OK    $m" -ForegroundColor Green } else { Write-Host "FALHA $m" -ForegroundColor Red; $script:falhas++ } }

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 900, 450
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(205, 205, 210))
$g.FillRectangle([System.Drawing.Brushes]::White, 60, 60, 780, 330)
$fonte = New-Object System.Drawing.Font 'Arial', 40, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('TORNEIRA ACME 35', $fonte, [System.Drawing.Brushes]::Black, 90, 100)
$g.DrawString('Modelo LV-220   1200 W', $fonte, [System.Drawing.Brushes]::DarkRed, 90, 220)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$b64 = [Convert]::ToBase64String($ms.ToArray())
Write-Host "Imagem de teste: $([int]($b64.Length / 1024)) KB em base64"

function Descrever($corpo) {
  try {
    return Invoke-RestMethod -Method POST -Uri "$W/descrever" -Headers $h -ContentType 'application/json; charset=utf-8' -Body ($corpo | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 90
  } catch {
    $st = $_.Exception.Response.StatusCode.value__
    Write-Host "  erro $st $($_.ErrorDetails.Message)" -ForegroundColor Yellow
    return $null
  }
}

Write-Host "`n1) Sem guardar a foto"
$r = Descrever @{ texto = 'teste da pagina'; area = 'Canalizacao'; fotos = @($b64) }
Ok ($null -ne $r) 'o Worker respondeu'
if ($r) {
  Write-Host "  modelo: $($r.modelo)"
  foreach ($f in @($r.falhas)) { Write-Host "  antes falhou: $f" -ForegroundColor Yellow }
  Write-Host "  descricao: $($r.descricao)"
  Ok ($r.descricao -match 'ACME') 'a descricao leu o texto da imagem (ACME)'
  Ok ($r.guardadas -eq 0) 'sem id: nao guarda a foto'
}

Write-Host "`n2) Guardando a foto (id verificacao0)"
$r = Descrever @{ id = 'verificacao0'; texto = 'teste da pagina'; fotos = @($b64) }
Ok ($r -and $r.guardadas -eq 1) 'a foto ficou guardada em fotos/verificacao0/1.jpg'

$chave = $null
if ($falhas) { Write-Host "`n$falhas falha(s)" -ForegroundColor Red; exit 1 } else { Write-Host "`nTudo OK" -ForegroundColor Green }
