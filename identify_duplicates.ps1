# Script de identificare produse duplicat (IMP-/OCR- vs Produse Reale)
# Citește din Supabase, compară denumirile și generează un raport.

$envContent = Get-Content .env;
$serviceKeyLine = $envContent | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" };
$serviceKey = ($serviceKeyLine -split '=')[1].Trim().Trim('"');
$headers = @{
  "apikey" = $serviceKey
  "Authorization" = "Bearer $serviceKey"
};

# 1. Fetch all products from Supabase using pagination (limit and offset)
Write-Output "Se descarcă produsele din Supabase în tranșe de 1000...";
$allProducts = @();
$pageSize = 1000;
for ($pIndex = 0; ; $pIndex++) {
  $from = $pIndex * $pageSize;
  
  $url = "https://eklxkylfqlrkwoqtgpcw.supabase.co/rest/v1/products?select=id,cod_intern,denumire_completa,pret_lista&limit=$pageSize&offset=$from";
  $batch = Invoke-RestMethod -Uri $url -Headers $headers -Method Get;
  
  if ($batch.Count -eq 0 -or $batch -eq $null) { break; }
  $allProducts += $batch;
  Write-Output "Descărcate: $($allProducts.Count) produse...";
  if ($batch.Count -lt $pageSize) { break; }
}

Write-Output "Descărcare completă. Total produse: $($allProducts.Count)";

# 2. Separam produsele in Test/Import si Produse Reale
$importProducts = @();
$realProducts = @();

foreach ($p in $allProducts) {
  if ($p.cod_intern -like "IMP-*" -or $p.cod_intern -like "OCR-*") {
    $importProducts += $p;
  } else {
    $realProducts += $p;
  }
}

Write-Output "Produse Import/OCR: $($importProducts.Count)";
Write-Output "Produse Reale: $($realProducts.Count)";

# 3. Helpers pentru normalizare și tokenizare
function Get-NameTokens($name) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  if ([string]::IsNullOrEmpty($name)) { return $set }
  $norm = $name.Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $norm.ToCharArray()) {
    if ([System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
      $null = $sb.Append($c)
    }
  }
  $clean = $sb.ToString().ToLower()
  $clean = $clean -replace '[^a-z0-9]', ' '
  $tokens = $clean.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries) | Where-Object { $_.Length -ge 2 }
  
  if ($tokens) {
    foreach ($t in $tokens) {
      $null = $set.Add($t)
    }
  }
  return $set
}

# Extrage numerele (ex: greutate, volum) dintr-un string pentru a asigura potrivirea exactă a cantității
function Get-Numbers($name) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  if ([string]::IsNullOrEmpty($name)) { return $set }
  $matches = [regex]::Matches($name.ToLower(), '\b\d+(?:\.\d+)?\b')
  foreach ($m in $matches) {
    $null = $set.Add($m.Value)
  }
  return $set
}

Write-Output "`nPre-procesare produse reale (tokenizare și extragere numere)...";
$realProcessed = @();
foreach ($real in $realProducts) {
  $realProcessed += [PSCustomObject]@{
    product = $real
    tokens  = Get-NameTokens $real.denumire_completa
    numbers = Get-Numbers $real.denumire_completa
  }
}

Write-Output "Pre-procesare produse import...";
$importProcessed = @();
foreach ($imp in $importProducts) {
  $importProcessed += [PSCustomObject]@{
    product = $imp
    tokens  = Get-NameTokens $imp.denumire_completa
    numbers = Get-Numbers $imp.denumire_completa
  }
}

Write-Output "Se analizează potrivirile...";

$duplicates = @();

foreach ($imp in $importProcessed) {
  $impTokens = $imp.tokens;
  $impNumbers = $imp.numbers;
  $impProduct = $imp.product;
  
  $bestMatch = $null;
  $bestScore = 0;
  
  foreach ($real in $realProcessed) {
    $realTokens = $real.tokens;
    $realNumbers = $real.numbers;
    $realProduct = $real.product;
    
    # Verificăm dacă numerele din denumire se potrivesc (ex: 22kg cu 22kg, nu cu 4kg)
    if ($impNumbers.Count -gt 0 -and $realNumbers.Count -gt 0) {
      $mismatch = $false;
      foreach ($n in $impNumbers) {
        if (-not $realNumbers.Contains($n)) {
          $mismatch = $true;
          break;
        }
      }
      if ($mismatch) { continue }
    }
    
    # Calculăm scorul de potrivire (proporția de cuvinte cheie comune)
    if ($impTokens.Count -eq 0) { continue }
    
    $common = 0;
    foreach ($t in $impTokens) {
      if ($realTokens.Contains($t)) {
        $common++;
      }
    }
    
    $score = $common / $impTokens.Count;
    
    # De asemenea, calculăm și acoperirea inversă pentru a evita potriviri greșite
    $revCommon = 0;
    foreach ($t in $realTokens) {
      if ($impTokens.Contains($t)) {
        $revCommon++;
      }
    }
    $revScore = 0;
    if ($realTokens.Count -gt 0) {
      $revScore = $revCommon / $realTokens.Count;
    }
    
    $combinedScore = ($score * 0.6) + ($revScore * 0.4);
    
    if ($combinedScore -gt $bestScore) {
      $bestScore = $combinedScore;
      $bestMatch = $realProduct;
    }
  }
  
  # Prag de potrivire ridicat (0.65)
  if ($bestScore -ge 0.65 -and $bestMatch -ne $null) {
    $duplicates += [PSCustomObject]@{
      "imp_id" = $impProduct.id
      "imp_cod" = $impProduct.cod_intern
      "imp_name" = $impProduct.denumire_completa
      "imp_pret" = $impProduct.pret_lista
      "real_id" = $bestMatch.id
      "real_cod" = $bestMatch.cod_intern
      "real_name" = $bestMatch.denumire_completa
      "real_pret" = $bestMatch.pret_lista
      "score" = [Math]::Round($bestScore, 3)
    }
  }
}

Write-Output "Analiză finalizată. S-au identificat $($duplicates.Count) posibile dubluri.";

# Salvează raportul ca JSON
$json = $duplicates | ConvertTo-Json -Depth 5;
[System.IO.File]::WriteAllText("$PSScriptRoot\duplicates_report.json", $json);
Write-Output "Report saved. Count: $($duplicates.Count)";

# Afișează primele 15 dubluri
Write-Output "`nTop 15 dubluri identificate:";
$duplicates | Sort-Object -Property score -Descending | Select-Object -First 15 | Format-Table -Wrap;

