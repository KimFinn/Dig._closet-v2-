<#
=============================================================================
 Dig._closet-v2- backend -- Phase 0 verification script
=============================================================================
 What this checks, in order:
   1. Registers/logs in two throwaway test users (A and B) -- safe to
      re-run, it logs in instead of erroring if they already exist.
   2. Uploads a real clothing item as User A.
   3. Attempts every relevant action as User B against User A's item and
      user-scoped data -- every one of these MUST be blocked (401/403/404).
      This is the IDOR fix -- these are the security-critical checks.
   4. Repeats the same actions as User A (the rightful owner) -- every one
      of these MUST succeed.
   5. Hits GET /clothes/search and GET /clothes/ai-stats, which used to
      500 with "invalid input syntax for type uuid" because of a route-
      ordering bug.
   6. Creates an Outfit and a Trip as User A and checks the returned
      userId actually matches User A (this was the req.user.id vs
      req.user.userId bug that made outfits/trips/preferences silently
      broken).
   7. Prints a PASS/FAIL summary. Non-zero exit code if anything failed.

 BEFORE RUNNING:
   - `npm run dev` must be running in one terminal.
   - `npm run worker` must be running in another terminal. It does NOT
     hot-reload -- if you changed anything, stop it (Ctrl+C) and run
     `npm run worker` again before this script.
   - If your real .env points at a managed/cloud Redis that requires TLS
     (e.g. Redis Cloud), set REDIS_TLS=true in .env and restart both
     `npm run dev` and `npm run worker`. Leave REDIS_TLS=false/unset for a
     plain local Redis (Docker/WSL) -- forcing TLS against a non-TLS Redis
     doesn't fail fast, it hangs every cache-touching request instead.

 HOW TO RUN:
   cd to the backend folder, then:
     .\verify-phase0.ps1

 This script never commits or pushes anything -- it only talks to your
 local running server over HTTP.
=============================================================================
#>

$ErrorActionPreference = 'Stop'
$baseUrl = 'http://localhost:8000/api/v1'

$script:pass = 0
$script:fail = 0

function Write-Pass($msg) { $script:pass++; Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Fail($msg) { $script:fail++; Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# -----------------------------------------------------------------------
# Every request goes through curl.exe (not Invoke-RestMethod/-WebRequest):
# curl.exe ships with Windows 10/11 and behaves identically across
# Windows PowerShell 5.1 and PowerShell 7+, where Invoke-WebRequest's
# error handling differs. It also matches what you already tested
# manually earlier. Returns @{ Status = <int>; Body = <parsed-json-or-$null> }
# and NEVER throws on a non-2xx response -- a 403/404/500 is just data
# to assert on, which is the whole point of this script.
# -----------------------------------------------------------------------
function Invoke-Api {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [string]$Token,
        $Body
    )

    # JSON bodies are written to a temp file and sent with --data-binary
    # "@file" rather than passed inline as -d "<json>". Windows PowerShell
    # (5.1 AND 7+) mangles double quotes when it reconstructs the argv
    # string for a native executable like curl.exe, so a JSON string
    # containing embedded " characters arrives at curl corrupted (this is
    # exactly what caused the "Expected property name or '}'" error --
    # the quotes around field names got stripped in transit). Going
    # through a file sidesteps that entirely: the only argument curl.exe
    # ever sees is a plain file path with no quote characters in it.
    $tmpFile = $null
    $curlArgs = @('-s', '-w', "`nHTTPSTATUS:%{http_code}", '-X', $Method, "$baseUrl$Path")
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        $tmpFile = [System.IO.Path]::GetTempFileName()
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($tmpFile, $json, $utf8NoBom)
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$tmpFile")
    }

    try {
        $raw = & curl.exe @curlArgs
        $rawText = ($raw -join "`n")
        $idx = $rawText.LastIndexOf('HTTPSTATUS:')
        if ($idx -lt 0) {
            return @{ Status = 0; Body = $null }
        }
        $status = [int]($rawText.Substring($idx + 11).Trim())
        $bodyText = $rawText.Substring(0, $idx).Trim()
        $parsedBody = $null
        if ($bodyText) { try { $parsedBody = $bodyText | ConvertFrom-Json } catch {} }
        return @{ Status = $status; Body = $parsedBody }
    } finally {
        if ($tmpFile) { Remove-Item -Path $tmpFile -ErrorAction SilentlyContinue }
    }
}

function Invoke-Upload {
    param([Parameter(Mandatory)][string]$Token, [Parameter(Mandatory)][string]$ImagePath)

    $curlArgs = @(
        '-s', '-w', "`nHTTPSTATUS:%{http_code}",
        '-X', 'POST', "$baseUrl/clothes/upload",
        '-H', "Authorization: Bearer $Token",
        '-F', "image=@$ImagePath;type=image/jpeg"
    )
    $raw = & curl.exe @curlArgs
    $rawText = ($raw -join "`n")
    $idx = $rawText.LastIndexOf('HTTPSTATUS:')
    $status = [int]($rawText.Substring($idx + 11).Trim())
    $bodyText = $rawText.Substring(0, $idx).Trim()
    $parsedBody = $null
    if ($bodyText) { try { $parsedBody = $bodyText | ConvertFrom-Json } catch {} }
    return @{ Status = $status; Body = $parsedBody }
}

function Assert-Status($result, [int]$Expected, [string]$Label) {
    if ($result.Status -eq $Expected) {
        Write-Pass "$Label -> $($result.Status)"
    } else {
        $msg = $result.Body.message
        Write-Fail "$Label -> expected $Expected, got $($result.Status)$(if ($msg) { " ($msg)" })"
    }
}

function Assert-Blocked($result, [string]$Label) {
    if ($result.Status -in 401, 403, 404) {
        Write-Pass "$Label -> correctly blocked ($($result.Status))"
    } else {
        Write-Fail "$Label -> NOT BLOCKED (got $($result.Status)) -- security bug, investigate before pushing"
    }
}

function Register-Or-Login {
    param([Parameter(Mandatory)][string]$Email, [Parameter(Mandatory)][string]$Password, [Parameter(Mandatory)][string]$FullName)

    $reg = Invoke-Api -Method POST -Path '/auth/register' -Body @{
        email = $Email; password = $Password; fullName = $FullName
    }

    if ($reg.Status -eq 201) {
        Write-Host "  Registered $Email"
    } else {
        Write-Host "  $Email already exists (or register failed with $($reg.Status)) -- logging in instead"
    }

    $login = Invoke-Api -Method POST -Path '/auth/login' -Body @{ email = $Email; password = $Password }
    if ($login.Status -ne 200) {
        throw "Could not log in as $Email (status $($login.Status)): $($login.Body | ConvertTo-Json -Depth 5)"
    }
    return @{ Token = $login.Body.data.token; UserId = $login.Body.data.user.id }
}

function New-TestImage {
    param([Parameter(Mandatory)][string]$Path)
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap(20, 20)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::SteelBlue)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $g.Dispose()
    $bmp.Dispose()
}

# =========================================================================
Write-Section "0. Quick reachability check"
# =========================================================================
try {
    $health = Invoke-WebRequest -Uri 'http://localhost:8000/health' -UseBasicParsing -TimeoutSec 5
    Write-Pass "Server is reachable on http://localhost:8000 (health check: $($health.StatusCode))"
} catch {
    Write-Host "Cannot reach http://localhost:8000/health -- is 'npm run dev' running? Stopping." -ForegroundColor Red
    exit 1
}

# =========================================================================
Write-Section "1. Register / login two test users"
# =========================================================================
$userA = Register-Or-Login -Email 'phase0-test-a@example.com' -Password 'Testpass1' -FullName 'Phase0 Test User A'
$userB = Register-Or-Login -Email 'phase0-test-b@example.com' -Password 'Testpass1' -FullName 'Phase0 Test User B'
Write-Host "  User A id: $($userA.UserId)"
Write-Host "  User B id: $($userB.UserId)"

# =========================================================================
Write-Section "2. Upload a clothing item as User A"
# =========================================================================
$imgPath = Join-Path $env:TEMP 'phase0-test-item.jpg'
New-TestImage -Path $imgPath
$upload = Invoke-Upload -Token $userA.Token -ImagePath $imgPath
Assert-Status $upload 202 'POST /clothes/upload (as User A)'

if ($upload.Status -ne 202 -or -not $upload.Body.data.clothingItem.id) {
    Write-Host "`nCould not create a test item -- cannot continue with the rest of the checks." -ForegroundColor Yellow
    Write-Host "Response body:" -ForegroundColor Yellow
    $upload.Body | ConvertTo-Json -Depth 10 | Write-Host
    exit 1
}
$itemId = $upload.Body.data.clothingItem.id
Write-Host "  Created item: $itemId"

# =========================================================================
Write-Section "3. Cross-user access as User B against User A's data (ALL must be blocked)"
# =========================================================================
Assert-Blocked (Invoke-Api -Method GET    -Path "/clothes/$itemId"                         -Token $userB.Token) 'GET /clothes/:itemId (B reading A''s item)'
Assert-Blocked (Invoke-Api -Method PUT    -Path "/clothes/$itemId" -Body @{ notes = 'hacked by B' } -Token $userB.Token) 'PUT /clothes/:itemId (B editing A''s item)'
Assert-Blocked (Invoke-Api -Method POST   -Path "/clothes/$itemId/wear"                     -Token $userB.Token) 'POST /clothes/:itemId/wear (B marking A''s item worn)'
Assert-Blocked (Invoke-Api -Method GET    -Path "/clothes/user/$($userA.UserId)"            -Token $userB.Token) 'GET /clothes/user/:userId (B listing A''s wardrobe)'
Assert-Blocked (Invoke-Api -Method GET    -Path "/clothes/analytics/$($userA.UserId)"       -Token $userB.Token) 'GET /clothes/analytics/:userId (B reading A''s analytics)'
Assert-Blocked (Invoke-Api -Method GET    -Path "/clothes/review/needed/$($userA.UserId)"   -Token $userB.Token) 'GET /clothes/review/needed/:userId (B reading A''s review queue)'
Assert-Blocked (Invoke-Api -Method DELETE -Path "/clothes/$itemId"                          -Token $userB.Token) 'DELETE /clothes/:itemId (B deleting A''s item)'

# =========================================================================
Write-Section "4. Same actions as User A, the rightful owner (ALL must succeed)"
# =========================================================================
Assert-Status (Invoke-Api -Method GET  -Path "/clothes/$itemId"                       -Token $userA.Token) 200 'GET /clothes/:itemId (A reading own item)'
Assert-Status (Invoke-Api -Method PUT  -Path "/clothes/$itemId" -Body @{ notes = 'updated by owner' } -Token $userA.Token) 200 'PUT /clothes/:itemId (A editing own item)'
Assert-Status (Invoke-Api -Method POST -Path "/clothes/$itemId/wear"                  -Token $userA.Token) 200 'POST /clothes/:itemId/wear (A marking own item worn)'
Assert-Status (Invoke-Api -Method GET  -Path "/clothes/user/$($userA.UserId)"         -Token $userA.Token) 200 'GET /clothes/user/:userId (A listing own wardrobe)'
Assert-Status (Invoke-Api -Method GET  -Path "/clothes/analytics/$($userA.UserId)"    -Token $userA.Token) 200 'GET /clothes/analytics/:userId (A reading own analytics)'
Assert-Status (Invoke-Api -Method GET  -Path "/clothes/review/needed/$($userA.UserId)" -Token $userA.Token) 200 'GET /clothes/review/needed/:userId (A reading own review queue)'

# =========================================================================
Write-Section "5. Previously-broken routes (route-ordering bug: /search and /ai-stats used to 500)"
# =========================================================================
Assert-Status (Invoke-Api -Method GET -Path '/clothes/search?query=test' -Token $userA.Token) 200 'GET /clothes/search'
Assert-Status (Invoke-Api -Method GET -Path '/clothes/ai-stats'          -Token $userA.Token) 200 'GET /clothes/ai-stats'

# =========================================================================
Write-Section "6. Outfit + Trip creation (req.user.id -> req.user.userId bug)"
# =========================================================================
$outfitResult = Invoke-Api -Method POST -Path '/outfit' -Token $userA.Token -Body @{
    name     = 'Phase 0 test outfit'
    items    = @($itemId)
    occasion = 'casual'
}
Assert-Status $outfitResult 201 'POST /outfit (create)'
$outfitUserId = $outfitResult.Body.data.outfit.userId
if ($outfitUserId -eq $userA.UserId) {
    Write-Pass "Outfit userId correctly set to the authenticated user ($outfitUserId)"
} else {
    Write-Fail "Outfit userId is '$outfitUserId', expected '$($userA.UserId)' -- req.user.id/userId bug may have regressed"
}

$tripResult = Invoke-Api -Method POST -Path '/trip' -Token $userA.Token -Body @{
    destination = 'Nairobi'
    startDate   = (Get-Date).AddDays(30).ToString('yyyy-MM-dd')
    endDate     = (Get-Date).AddDays(35).ToString('yyyy-MM-dd')
}
Assert-Status $tripResult 201 'POST /trip (create)'
$tripUserId = $tripResult.Body.data.trip.userId
if ($tripUserId -eq $userA.UserId) {
    Write-Pass "Trip userId correctly set to the authenticated user ($tripUserId)"
} else {
    Write-Fail "Trip userId is '$tripUserId', expected '$($userA.UserId)' -- req.user.id/userId bug may have regressed"
}

# =========================================================================
Write-Section "7. Cleanup"
# =========================================================================
Assert-Status (Invoke-Api -Method DELETE -Path "/clothes/$itemId" -Token $userA.Token) 200 'DELETE /clothes/:itemId (A deleting own test item, cleanup)'
Remove-Item -Path $imgPath -ErrorAction SilentlyContinue

# =========================================================================
Write-Section "Summary"
# =========================================================================
Write-Host "  Passed: $script:pass" -ForegroundColor Green
Write-Host "  Failed: $script:fail" -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })

if ($script:fail -eq 0) {
    Write-Host "`nAll checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n$script:fail check(s) failed -- see the [FAIL] lines above and fix before pushing to GitHub." -ForegroundColor Red
    exit 1
}
