#!/usr/bin/env node
const fs = require('fs');
const src = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/bin/language_server_windows_x64.exe');
const text = src.toString('utf-8', 0, Math.min(src.length, 200 * 1024 * 1024));

function findAll(pattern, max = 5) {
  const results = [];
  let idx = 0;
  while (results.length < max) {
    idx = text.indexOf(pattern, idx);
    if (idx === -1) break;
    const ctx = text.substring(Math.max(0, idx - 30), Math.min(text.length, idx + pattern.length + 200))
      .replace(/[\x00-\x1f]/g, ' ').trim();
    results.push({ offset: idx, ctx: ctx.substring(0, 350) });
    idx += pattern.length;
  }
  return results;
}

function section(title, patterns) {
  console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);
  for (const p of patterns) {
    const results = findAll(p);
    if (results.length > 0) {
      for (const r of results) {
        console.log(`\n[${p}] @${r.offset}:\n  ${r.ctx}`);
      }
    }
  }
}

section('1. PROMPT CONSTRUCTION (system prompt 组装)', [
  'system_prompt_construction',
  'cumulative_prompt',
  'persistent_context_multiplier',
  'trajectory_context_multiplier',
  'ephemeral_context_multiplier',
  'GetSystemPromptAndTools',
  'prompt_template_sections',
  'buildSystemPrompt',
  'system_prompt_sections',
]);

section('2. SUPERCOMPLETE / TAB (代码补全引擎)', [
  'HandleStreamingTab',
  'supercomplete_model',
  'SupercompleteActiveDoc',
  'TabJump',
  'tab_completion',
  'HandleStreamingCommand',
  'ReceiveCompletionProfile',
  'streaming_tab_v2',
]);

section('3. FAST APPLY (快速应用)', [
  'fast_apply',
  'FastApply',
  'fast_apply_fallback',
  'apply_patch',
  'ApplyPatch',
  'fuzzy_sandwich',
]);

section('4. VIBE AND REPLACE', [
  'VibeAndReplace',
  'vibe_edit',
  'vibe_skip',
  'vibeResult',
]);

section('5. DEPLOY / WINDSURF.BUILD', [
  'windsurf.build',
  'WindsurfJSApp',
  'GetWindsurfJS',
  'deploy_target',
  'DeployTarget',
  'deploy_web_app',
  'netlify_sandbox',
  'supabase_secret',
]);

section('6. CONTEXT MODULE INTERNALS', [
  'context_module_state',
  'ContextModuleResult',
  'cci_per_source',
  'term_frequency_map',
  'oracle_items',
  'pinned_context',
  'mentioned_scope',
]);

section('7. CODE RETRIEVAL (11种检索器)', [
  'RETRIEVER_TYPE_CONTEXT_MODULE',
  'RETRIEVER_TYPE_MQUERY',
  'RETRIEVER_TYPE_COMMIT_GRAPH',
  'RETRIEVER_TYPE_MORPH',
  'RETRIEVER_TYPE_GRAPH_CLUSTERS',
  'RETRIEVER_TYPE_OPENSEARCH',
  'commit_graph',
  'morph_normal',
  'morph_advanced',
]);

section('8. EMBEDDING / VECTOR INDEX', [
  'HALFVEC',
  'BINARY_WITH_RERANK',
  'BRUTE_FORCE',
  'vector_index',
  'num_embeddings',
  'GetNearestCCIs',
]);

section('9. DEEP WIKI', [
  'DeepWiki',
  'deep_wiki',
  'hover_context',
  'symbol_context',
  'function_call_info',
]);

section('10. GIT WORKTREE MANAGEMENT', [
  'max_worktrees',
  'worktree_at',
  'copyWorktreeFile',
  'worktree_merge',
  'git_worktree_path',
  'merge_base_commit',
]);
