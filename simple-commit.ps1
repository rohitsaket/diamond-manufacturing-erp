# Simple PowerShell script to commit executive dashboard changes
Set-Location -Path "d:\Project\diamond-manufacturing-erp"

# Define all files to add
$files = @(
    "frontend/src/pages/Dashboard/ExecutiveDashboard.tsx",
    "frontend/src/pages/Dashboard/hooks/useExecutiveDashboardData.ts",
    "frontend/src/pages/Dashboard/components/executive/DepartmentHealthMap.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveHeader.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveKpiGrid.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveOverviewChart.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveQuickActions.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveRecentAlerts.tsx",
    "frontend/src/pages/Dashboard/components/executive/FinancialPerformance.tsx",
    "frontend/src/pages/Dashboard/components/executive/ProductionEfficiencyGauge.tsx",
    "frontend/src/pages/Dashboard/components/executive/TopPerformingTeams.tsx"
)

# Add files
& "C:\Program Files\Git\cmd\git.exe" add $files

# Commit
if ($LASTEXITCODE -eq 0) {
    & "C:\Program Files\Git\cmd\git.exe" commit -m "feat: Complete executive dashboard implementation with all required components"
    Write-Host "Commit completed successfully"
} else {
    Write-Error "git add failed with exit code $LASTEXITCODE"
}