param(
    [Parameter(Mandatory = $true)][int]$MainPid,
    [Parameter(Mandatory = $true)][string]$ExePath
)

# dsh-plugin-easy2restart 重启脚本
# 由 Windows 计划任务 (schtasks) 拉起，因此脱离 DSH 进程树，
# 即使 DSH 被 /T 强杀，本脚本仍能存活并完成重启。

# 1) 结束 DSH 主进程及其整个进程树
& taskkill /PID $MainPid /T /F 2>$null | Out-Null

# 2) 等多个含 DSH 名的进程都退出（最多约 20 秒）
$deadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 400
    $still = Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue
} while ($still -and (Get-Date) -lt $deadline)

Start-Sleep -Milliseconds 800

# 3) 重新启动桌面应用（不等待它退出）
if (Test-Path -LiteralPath $ExePath) {
    Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path -Parent $ExePath)
}