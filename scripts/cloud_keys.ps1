# Cloud keys helper: copies each piece Faris pastes into claude.ai/code > Default > gear > API credentials,
# one at a time, so no key is ever typed, shown on screen, or saved in a new file. Clears the clipboard at the end.
$env = @{}
Get-Content "$HOME\.model-keys.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.+)$') { if (-not $env.ContainsKey($matches[1])) { $env[$matches[1]] = $matches[2].Trim().Trim('"') } }
}
$keys = @(
  @{ Name = "Groq";       Site = "api.groq.com";                        Var = "GROQ_API_KEY" },
  @{ Name = "OpenRouter"; Site = "openrouter.ai";                       Var = "OPENROUTER_API_KEY" },
  @{ Name = "Gemini";     Site = "generativelanguage.googleapis.com";   Var = "GEMINI_API_KEY" },
  @{ Name = "Fluxion";    Site = "fluxionai.world";                     Var = "FLUXION_API_KEY" },
  @{ Name = "Cursor";     Site = "api.cursor.com";                      Var = "CURSOR_API_KEY" }
)
function Step($what, $value) {
  Set-Clipboard -Value $value
  Read-Host "  Copied $what. Paste it (Ctrl+V), then press Enter here"
}
Write-Host "`nIn Chrome: open https://claude.ai/code > click 'Default' under the message box > Cloud > hover 'Default' > click the gear."
Write-Host "Scroll down to 'API credentials'. (The web addresses are already saved. Do not touch 'Allowed domains'.)"
foreach ($k in $keys) {
  if (-not $env[$k.Var]) { Write-Host "`n(skipping $($k.Name): no key on this laptop)"; continue }
  Write-Host "`n=== $($k.Name) ==="
  Write-Host "Click 'Add credential'. 'Credential type' is already Bearer: leave it."
  Step "the name ($($k.Name)) for the 'Name' box" $k.Name
  Step "the website ($($k.Site)) for the 'Allowed websites' box (then click the next box so it turns into a chip)" $k.Site
  Step "the $($k.Name) KEY for the masked 'Value' box under 'Custom headers' (you will only see dots)" $env[$k.Var]
  Write-Host "  Now click 'Connect'. Wait until $($k.Name) shows in the credentials list."
}
Set-Clipboard -Value " "
Write-Host "`nLast: scroll to the bottom of the window and click 'Save changes' (not 'Archive'). Clipboard cleared. You can close this window."
Read-Host "Press Enter to close"
