# Verifica o Worker publicado, de ponta a ponta, com a ADMIN_KEY.
# Grava um ficheiro de teste (historico/verificacao0.json) no garagem-dados, lê-o e apaga-o.
# Fica no histórico do git do garagem-dados: 2 commits (mais o README, se o repositório estava vazio).
# Correr: powershell -ExecutionPolicy Bypass -File worker\verificar.ps1

$W = 'https://api-github-garagem-dados.rmleston.workers.dev'
$s = Read-Host -AsSecureString 'ADMIN_KEY (não aparece no ecrã)'
$chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$h = @{ Origin = 'https://r-lst.github.io'; Authorization = "Bearer $chave" }
$falhas = 0
function Ok($c, $m) { if ($c) { Write-Host "✓ $m" -ForegroundColor Green } else { Write-Host "✗ $m" -ForegroundColor Red; $script:falhas++ } }
function Pedir($metodo, $rota, $corpo) {
  try {
    $p = @{ Method = $metodo; Uri = "$W$rota"; Headers = $h; ContentType = 'application/json; charset=utf-8' }
    if ($corpo) { $p.Body = ($corpo | ConvertTo-Json -Depth 6 -Compress) }
    return Invoke-RestMethod @p
  } catch {
    $st = $_.Exception.Response.StatusCode.value__
    Write-Host "  erro $st $($_.ErrorDetails.Message)" -ForegroundColor Yellow
    return $null
  }
}

$caminho = 'historico/verificacao0.json'
$l = Pedir GET '/lista'
Ok ($null -ne $l) "lista ($(@($l.ficheiros).Count) ficheiros no garagem-dados)"
if ($null -eq $l) { Write-Host 'Sem lista não vale a pena continuar (chave errada? 401 = chave; 502 = token ou GITHUB_REPO).'; exit 1 }

$agora = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$g = Pedir POST '/gravar' @{ ficheiros = @(@{ path = $caminho; conteudo = @{ id = 'verificacao0'; atualizado = $agora; apagado = $true } }) }
Ok ($null -ne $g -and $g.shas.$caminho) 'gravar um ficheiro de teste (1 commit)'

$l = Pedir GET '/lista'
$f = @($l.ficheiros) | Where-Object { $_.path -eq $caminho }
Ok ($null -ne $f) 'o ficheiro aparece na lista'
Ok ($f -and $f.sha -eq $g.shas.$caminho) 'o sha calculado pelo Worker é igual ao do GitHub'

if ($f) {
  $r = Pedir POST '/ler' @{ shas = @($f.sha) }
  Ok ($r -and $r.conteudos.($f.sha).atualizado -eq $agora) 'ler o ficheiro devolve o que foi gravado'
}

$a = Pedir POST '/gravar' @{ ficheiros = @(@{ path = $caminho; conteudo = $null }) }
Ok ($null -ne $a) 'apagar o ficheiro de teste (só com ADMIN_KEY)'
$l = Pedir GET '/lista'
Ok (-not (@($l.ficheiros) | Where-Object { $_.path -eq $caminho })) 'o ficheiro saiu da lista'

$chave = $null
if ($falhas) { Write-Host "`n$falhas falha(s)" -ForegroundColor Red; exit 1 } else { Write-Host "`nTudo OK" -ForegroundColor Green }
