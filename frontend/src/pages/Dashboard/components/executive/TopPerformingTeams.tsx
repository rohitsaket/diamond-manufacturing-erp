import { memo } from 'react';
import { Users, TrendingUp, Medal, ArrowRight, User } from 'lucide-react';
import { ExecutiveTeam } from '../../hooks/useExecutiveDashboardData';

interface TopPerformingTeamsProps {
  teams: ExecutiveTeam[];
  onViewAllTeams: () => void;
}

const RANK_STYLES = [
  { bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800' },
  { bg: 'bg-gray-100 dark:bg-gray-200/30', icon: 'text-gray-600 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-700' },
  { bg: 'bg-orange-100 dark:bg-orange-900/30', icon: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800' },
];

function TopPerformingTeamsBase({ teams, onViewAllTeams }: TopPerformingTeamsProps) {
  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Users size={20} className="text-primary" />
            Top Performing Teams
          </h3>
          <p className="text-text-muted text-sm mt-1">Highest productivity and quality scores</p>
        </div>
        <button
          onClick={onViewAllTeams}
          className="flex items-center gap-1 text-primary text-sm font-medium hover:underline"
        >
          All Teams <ArrowRight size={16} />
        </button>
      </div>

      {/* Top teams list */}
      <div className="space-y-3">
        {teams.slice(0, 5).map((team, index) => {
          const isTopThree = index < 3;
          const rankStyle = isTopThree ? RANK_STYLES[index] : null;
          
          return (
            <div
              key={team.id}
              className={`p-4 rounded-xl border transition-all hover:shadow-sm ${isTopThree ? rankStyle?.bg + ' ' + rankStyle?.border : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'}`}
            >
              <div className="flex items-center gap-3">
                {/* Rank indicator */}
                {isTopThree ? (
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center ${rankStyle?.icon}`}>
                    <Medal size={16} />
                  </span>
                ) : (
                  <span className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-text-muted text-xs font-semibold">
                    {index + 1}
                  </span>
                )}

                {/* Team info */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-text-primary text-sm truncate">{team.name}</h4>
                  <p className="text-xs text-text-muted mt-0.5">{team.department} • {team.members} members</p>
                </div>

                {/* Performance metrics */}
                <div className="text-right">
                  <p className="font-bold text-text-primary">{team.productivityScore}%</p>
                  <div className={`flex items-center gap-1 justify-end text-xs ${team.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <TrendingUp size={10} className={team.trend < 0 ? 'rotate-180' : ''} />
                    {team.trend >= 0 ? '+' : ''}{team.trend}%
                  </div>
                </div>
              </div>

              {/* Team members avatars (minimal) */}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {team.teamLeaders?.slice(0, 3).map((leader, i) => (
                    <div 
                      key={i}
                      className="w-6 h-6 rounded-full bg-primary/10 border-2 border-white dark:border-gray-800 flex items-center justify-center"
                      title={leader.name}
                    >
                      <User size={10} className="text-primary" />
                    </div>
                  ))}
                  {team.teamLeaders && team.teamLeaders.length > 3 && (
                    <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 border-2 border-white dark:border-gray-800 flex items-center justify-center">
                      <span className="text-[10px] font-medium text-text-muted">+{team.teamLeaders.length - 3}</span>
                    </div>
                  )}
                </div>
                <span className="text-xs text-text-muted">Quality: {team.qualityRate}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary stats */}
      <div className="mt-6 pt-6 border-t border-border-light grid grid-cols-2 gap-4">
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-xl font-bold text-green-600 dark:text-green-400">
            {teams.filter(t => t.productivityScore >= 90).length}
          </p>
          <p className="text-xs text-text-muted">High performing</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
            {teams.reduce((acc, t) => acc + t.members, 0)}
          </p>
          <p className="text-xs text-text-muted">Total employees</p>
        </div>
      </div>
    </div>
  );
}

export const TopPerformingTeams = memo(TopPerformingTeamsBase);