#!/usr/bin/env node
const fs = require('fs');
const src = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/bin/language_server_windows_x64.exe');

function findStrings(patterns, contextBefore, contextAfter) {
  const text = src.toString('utf-8', 0, Math.min(src.length, 200 * 1024 * 1024));
  for (const p of patterns) {
    const idx = text.indexOf(p);
    if (idx !== -1) {
      const start = Math.max(0, idx - (contextBefore || 0));
      const end = Math.min(text.length, idx + p.length + (contextAfter || 100));
      const ctx = text.substring(start, end).replace(/[\x00-\x1f]/g, ' ').trim();
      console.log(`[${p}] @${idx}: ${ctx.substring(0, 300)}`);
    }
  }
}

console.log('=== 1. BRAIN SYSTEM ===\n');
findStrings([
  'brain_update_strategy',
  'BrainUpdateTrigger',
  'brain_model_uid',
  'brain_entry_type',
  'task_delta_type',
  'forced_brain_update',
  'dynamic_brain_update',
], 50, 150);

console.log('\n=== 2. ARENA MODE ===\n');
findStrings([
  'arena_assignment_jwt',
  'arena_invocation_cap',
  'arena_model_uid',
  'spawn_arena_mid_conversation',
  'converge_arena',
  'is_random_mode',
], 50, 150);

console.log('\n=== 3. PARALLEL ROLLOUT ===\n');
findStrings([
  'num_parallel_rollouts',
  'guide_model_uid',
  'max_guide_invocations',
  'force_bad_rollout',
  'parallel_rollout_config',
], 50, 150);

console.log('\n=== 4. SMART FRIEND / SUBAGENT ===\n');
findStrings([
  'smart_friend_model_uid',
  'SmartFriend',
  'task_subagent',
  'TaskSubagent',
  'explore_response',
  'ExploreAgent',
  'SyncExploreAgentRun',
], 50, 150);

console.log('\n=== 5. PASSIVE CODER ===\n');
findStrings([
  'passive_coder',
  'PassiveCoder',
  'supercomplete_active_doc',
  'supercomplete_ephemeral',
  'SupercompleteActiveDoc',
], 50, 150);

console.log('\n=== 6. VIRTUAL FILESYSTEM ===\n');
findStrings([
  'virtual_fs_serialized_overlay',
  'MountCascadeFilesystem',
  'UnmountCascadeFilesystem',
  'cascade_filesystem',
], 50, 150);

console.log('\n=== 7. WORKTREE MERGE ===\n');
findStrings([
  'worktree_merge_snapshot',
  'WorktreeMergeSnapshot',
  'ResolveWorktreeChanges',
  'UndoWorktreeMerge',
  'fail_on_conflicts',
], 50, 150);

console.log('\n=== 8. DEPLOY / FORGE ===\n');
findStrings([
  'windsurf.build',
  'deploy_target',
  'windsurf_js_app',
  'WindsurfJSApp',
  'netlify',
  'deployment_interaction',
], 50, 150);

console.log('\n=== 9. IMPORT FROM CURSOR ===\n');
findStrings([
  'ImportFromCursor',
  'import_from_cursor',
  'cursor_rules',
  '.cursorrules',
], 50, 150);

console.log('\n=== 10. REPLAY / EVAL ===\n');
findStrings([
  'ReplayGroundTruthTrajectory',
  'ground_truth',
  'eval_mode',
  'EVAL_TASK',
  'eval_pb',
], 50, 150);

console.log('\n=== 11. AUTO CASCADE (CI/PR) ===\n');
findStrings([
  'auto_cascade_broadcast',
  'AutoCascade',
  'auto_cascade_manager',
  'ASYNC_PRR',
  'ASYNC_CF',
  'ASYNC_SL',
  'github_pull_request',
  'GithubCICheckStatus',
], 50, 150);

console.log('\n=== 12. VIBE AND REPLACE ===\n');
findStrings([
  'vibe_and_replace',
  'VibeAndReplace',
  'is_vibe_and_replace',
], 50, 150);

console.log('\n=== 13. TRANSCRIPTION / AUDIO ===\n');
findStrings([
  'GetTranscription',
  'StartAudioRecording',
  'EndAudioRecording',
  'average_volume',
  'whisper',
], 50, 150);

console.log('\n=== 14. DEEP THINK ===\n');
findStrings([
  'DeepThink',
  'deep_think',
  'exploration_document',
  'last_planner_response',
], 50, 150);
