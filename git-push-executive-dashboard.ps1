# PowerShell script to push executive dashboard changes
# This script properly handles paths with spaces and executes git commands

$projectPath = "d:\Project\diamond-manufacturing-erp"
$commitMessage = "feat: Complete executive dashboard implementation with all required components"

# Navigate to project directory
Set-Location -Path $projectPath -ErrorAction Stop
Write-Host "Successfully navigated to: $projectPath"

# List all executive dashboard files to add
$filesToAdd = @(
    "frontend/src/pages/Dashboard/ExecutiveDashboard.tsx",
    "frontend/src/pages/Dashboard/hooks/useExecutiveDashboardData.ts",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveHeader.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveKpiGrid.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveOverviewChart.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveQuickActions.tsx",
    "frontend/src/pages/Dashboard/components/executive/ExecutiveRecentAlerts.tsx",
    "frontend/src/pages/Dashboard/components/executive/ProductionEfficiencyGauge.tsx",
    "frontend/src/pages/Dashboard/components/executive/TopPerformingTeams.tsx",
    "frontend/src/pages/Dashboard/components/executive/FinancialPerformance.tsx",
    "frontend/src/pages/Dashboard/components/executive/DepartmentHealthMap.tsx"
)

# Add each file to git
foreach ($file in $filesToAdd) {
    if (Test-Path $file) {
        git add $file
        Write-Host "Added: $file"
    } else {
        Write-Warning "File not found: $file"
    }
}

# Commit changes
git commit -m $commitMessage
Write-Host "Changes committed successfully"

# Check if remote exists
$remoteExists = git remote -v
if ($remoteExists) {
    Write-Host "Remote configuration found:"
    Write-Host $remoteExists
    # Push to remote
    git push
    Write-Host "Changes pushed to remote repository"
} else {
    Write-Host "`nNo remote repository configured. To push your changes, add a remote origin:"
    Write-Host "git remote add origin https://github.com/your-username/your-repo.git"
    Write-Host "git push -u origin main"
}