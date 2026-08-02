@echo off
cd /d "d:\Project\diamond-manufacturing-erp"
echo Current directory: %cd%
git status
echo.
echo Adding executive dashboard files...
git add ^
frontend/src/pages/Dashboard/ExecutiveDashboard.tsx ^
frontend/src/pages/Dashboard/components/executive/DepartmentHealthMap.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveHeader.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveKpiGrid.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveOverviewChart.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveQuickActions.tsx ^
frontend/src/pages/Dashboard/components/executive/ExecutiveRecentAlerts.tsx ^
frontend/src/pages/Dashboard/components/executive/FinancialPerformance.tsx ^
frontend/src/pages/Dashboard/components/executive/ProductionEfficiencyGauge.tsx ^
frontend/src/pages/Dashboard/components/executive/TopPerformingTeams.tsx ^
frontend/src/pages/Dashboard/hooks/useExecutiveDashboardData.ts
echo.
echo Committing changes...
git commit -m "feat: Complete executive dashboard implementation with all required components"
echo.
echo Git commit completed. You will need to configure a remote repository to push these changes.
echo Use: git remote add origin <repository-url> then git push -u origin main