@echo off
cd /d "d:\Project\diamond-manufacturing-erp"

:: Add all executive dashboard files
"C:\Program Files\Git\cmd\git.exe" add frontend/src/pages/Dashboard/ExecutiveDashboard.tsx ^
frontend/src/pages/Dashboard/hooks/useExecutiveDashboardData.ts ^
frontend/src/pages/Dashboard/components/executive/DepartmentHealthMap.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveHeader.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveKpiGrid.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveOverviewChart.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveQuickActions.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveRecentAlerts.tsx ^
frontend/src/pages/Dashboard/components/executive/FinancialPerformance.tsx ^
frontend/src/pages/Dashboard/components/executive/ProductionEfficiencyGauge.tsx ^
frontend/src/pages/Dashboard/components/executive/TopPerformingTeams.tsx

:: Commit the changes
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: Complete executive dashboard implementation with all required components"

:: Check if commit was successful
if %errorlevel% equ 0 (
    echo Commit successful! To push, run:
    echo "C:\Program Files\Git\cmd\git.exe" push origin main
) else (
    echo Commit failed. Please check the errors above.
)