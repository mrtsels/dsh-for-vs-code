/**
 * InsightsTabs.tsx — Phase 3 洞察面板:技能/任务/子代理/Goals 四个 tab。
 * 纯展示 + 请求派发;数据全部来自 extension 的 meta:* 推送/拉取,无本地持久状态。
 */
import React, { useEffect, useState } from 'react';
import type { GoalView, JobView, SkillEntry, SubagentEntry } from '../src/agent/wire.js';

interface Props {
  sessionId: string | undefined;
  skills: SkillEntry[];
  jobs: JobView[];
  subagents: SubagentEntry[];
  goal: GoalView | undefined;
  onPost: (request: Parameters<typeof import('./bridge-client.js').post>[0]) => void;
}

type TabKey = 'skills' | 'jobs' | 'subagents' | 'goals';

const TAB_LABELS: Array<[TabKey, string]> = [
  ['skills', '技能'],
  ['jobs', '任务'],
  ['subagents', '子代理'],
  ['goals', 'Goals'],
];

function statusColor(status: JobView['status']): string {
  switch (status) {
    case 'running':
    case 'stopping':
      return 'var(--vscode-charts-yellow, #cca700)';
    case 'completed':
      return 'var(--vscode-charts-green, #89d185)';
    case 'failed':
    case 'killed':
      return 'var(--vscode-errorForeground, #f48771)';
  }
}

export function InsightsTabs({ sessionId, skills, jobs, subagents, goal, onPost }: Props): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('skills');
  const [goalInput, setGoalInput] = useState('');

  // 切 tab 或会话变化时拉取一次;之后靠 extension 推送刷新
  useEffect(() => {
    if (!sessionId) return;
    if (tab === 'skills') onPost({ type: 'meta:skills', sessionId });
    if (tab === 'jobs') onPost({ type: 'meta:jobs', sessionId });
    if (tab === 'subagents') onPost({ type: 'meta:subagents', sessionId });
    if (tab === 'goals') onPost({ type: 'meta:goals', sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅切 tab/会话时触发
  }, [tab, sessionId]);

  if (!sessionId) {
    return <div style={{ padding: 12, fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>打开或创建一个会话后查看。</div>;
  }

  const goalRef = goal?.goal;
  const canControlGoal = goalRef !== undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--vscode-editorWidget-border, #555)' }}>
        {TAB_LABELS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              fontSize: 12,
              opacity: tab === key ? 1 : 0.65,
              borderBottom: tab === key ? '2px solid var(--vscode-focusBorder, #007fd4)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, fontSize: 12 }}>
        {tab === 'skills' && (
          <div>
            {skills.length === 0 && <div style={{ color: 'var(--vscode-descriptionForeground)' }}>无技能(或加载中)。</div>}
            {skills.map((s) => (
              <div key={s.name} style={{ marginBottom: 8 }}>
                <div>
                  <code>{s.name}</code>
                  {!s.modelInvocable && <span style={{ color: 'var(--vscode-descriptionForeground)' }}> (仅用户可调)</span>}
                </div>
                <div style={{ color: 'var(--vscode-descriptionForeground)' }}>{s.description}</div>
                {s.whenToUse !== undefined && <div style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.8 }}>适用:{s.whenToUse}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === 'jobs' && (
          <div>
            {jobs.length === 0 && <div style={{ color: 'var(--vscode-descriptionForeground)' }}>无后台任务。</div>}
            {jobs.map((j) => (
              <div key={j.id} style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: statusColor(j.status) }}>● {j.status}</span>
                <span style={{ fontFamily: 'monospace' }}>{j.label}</span>
                <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>
                  {j.kind} {j.detail !== undefined ? `(${j.detail})` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {tab === 'subagents' && (
          <div>
            {subagents.length === 0 && <div style={{ color: 'var(--vscode-descriptionForeground)' }}>无子代理。</div>}
            {subagents.map((s) =>
              s.kind === 'diagnostic' ? (
                <div key={s.id} style={{ marginBottom: 8, color: 'var(--vscode-errorForeground)' }}>
                  诊断异常子代理 {s.id}({s.reason})
                </div>
              ) : (
                <div key={s.id} style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: s.activity === 'running' ? 'var(--vscode-charts-yellow, #cca700)' : 'var(--vscode-descriptionForeground)' }}>
                    {s.activity === 'running' ? '●' : '○'} {s.activity}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.label ?? s.id.slice(0, 18)}</span>
                  <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>{s.mode}</span>
                  {s.mode === 'continuable' && (
                    <button
                      type="button"
                      onClick={() => onPost({ type: 'subagent:interrupt', parentSessionId: sessionId, childSessionId: s.id })}
                    >
                      打断
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
        )}
        {tab === 'goals' && (
          <div>
            {goalRef === undefined ? (
              <div style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: 8 }}>该会话暂无 goal。创建后 agent 将围绕目标推进。</div>
            ) : (
              <div style={{ marginBottom: 8, padding: 8, border: '1px solid var(--vscode-editorWidget-border, #555)' }}>
                <div>
                  <b>{goalRef.objective}</b>
                </div>
                <div style={{ color: 'var(--vscode-descriptionForeground)', marginTop: 4 }}>
                  phase: {goalRef.phase} · 已推进 {goal?.roundsStarted ?? 0} 轮
                  {goalRef.maxGoalRounds !== undefined ? ` · 上限 ${goalRef.maxGoalRounds} 轮` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button type="button" onClick={() => onPost({ type: 'goal:control', sessionId, ref: { id: goalRef.id, revision: goalRef.revision }, action: 'pause' })} disabled={!canControlGoal}>
                    暂停
                  </button>
                  <button type="button" onClick={() => onPost({ type: 'goal:control', sessionId, ref: { id: goalRef.id, revision: goalRef.revision }, action: 'resume' })} disabled={!canControlGoal}>
                    恢复
                  </button>
                  <button type="button" onClick={() => onPost({ type: 'goal:control', sessionId, ref: { id: goalRef.id, revision: goalRef.revision }, action: 'complete' })} disabled={!canControlGoal}>
                    完成
                  </button>
                  <button type="button" onClick={() => onPost({ type: 'goal:control', sessionId, ref: { id: goalRef.id, revision: goalRef.revision }, action: 'clear' })} disabled={!canControlGoal}>
                    清除
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="新 goal 目标…"
                style={{ flex: 1, fontFamily: 'inherit' }}
              />
              <button
                type="button"
                disabled={goalInput.trim() === '' || goalRef !== undefined}
                onClick={() => {
                  onPost({ type: 'goal:create', sessionId, objective: goalInput.trim() });
                  setGoalInput('');
                }}
              >
                创建
              </button>
            </div>
            {goalRef !== undefined && <div style={{ color: 'var(--vscode-descriptionForeground)', marginTop: 6 }}>(每会话同时只有一个 active goal,需先清除/完成)</div>}
          </div>
        )}
      </div>
    </div>
  );
}
