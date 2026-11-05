/**
 * dsh-ASD-100 — always-on ASD-STE100 simplified output for DSH.
 *
 * Two halves, one file:
 *  - a systemPrompt section that injects the simple-english rule body into every
 *    request while the mode is on;
 *  - an `/asd100` command that flips the mode by creating or deleting one flag file.
 *
 * The flag file is the only state. Every prompt render re-reads it, so the mode is
 * shared by all sessions and takes effect without a restart.
 *
 * The command registry is the normal entry point. A composition whose slash input
 * never reaches a handler (the headless runner, for example) still gets the mode
 * by sending the command as a whole message, which the pre-step listener consumes.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-asd-100';
export const inject = ['systemPrompt'];

const USER_SKILL_DIR = join(homedir(), '.agents', 'skills', 'simple-english');
const PACKAGED_SKILL_DIR = fileURLToPath(new URL('../skills/simple-english', import.meta.url));
const DEFAULT_STATE_FILE = join(homedir(), '.dsh', 'dsh-asd-100', '.active');

const USAGE = 'Usage: /asd100 [on|off]';

const HEADER =
  'STE ACTIVE: write simplified English on the ASD-STE100 model in every reply and every document.';

const FALLBACK = [
  'Write plain English. Keep these rules.',
  '',
  '- A procedure sentence has 20 words at most. A descriptive sentence has 25 words at most.',
  '- One instruction per sentence. Use the imperative mood.',
  '- Use simple tenses and the active voice. Name the actor.',
  '- Put the condition before the command: "If the build fails, read the log."',
  '- Use can, will, and must only. Delete should, would, may, might, and could.',
  '- One word has one meaning in the whole document. Use "make sure that" for check, verify, confirm, ensure.',
  '- No semicolons, no em dashes, no contractions, no noun chains over three words.',
  '- State the fact. Delete words that carry no fact.',
  '- In replies: answer first, prose only. No headings, no bullets, no bold, no tables.',
].join('\n');

/** Drop a YAML frontmatter block. Returns the rule body only. */
export function stripFrontmatter(text) {
  return String(text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** Rule body from the installed simple-english skill, or null when it is absent. */
export function readBody(skillDir) {
  try {
    const body = stripFrontmatter(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).trim();
    return body || null;
  } catch {
    return null;
  }
}

/** The always-on text. The caller gates on isOn(), so this is never the empty string. */
export function renderSection(skillDir) {
  return HEADER + '\n\n' + (readBody(skillDir) ?? FALLBACK);
}

/** First candidate that holds a SKILL.md: the explicit dir, the user's copy, then the packaged copy. */
export function resolveSkillDir(preferred) {
  for (const dir of [preferred, USER_SKILL_DIR, PACKAGED_SKILL_DIR]) {
    if (dir && existsSync(join(dir, 'SKILL.md'))) return dir;
  }
  return USER_SKILL_DIR;
}

export function isOn(stateFile = DEFAULT_STATE_FILE) {
  try {
    return readFileSync(stateFile, 'utf8').trim().toLowerCase() === 'on';
  } catch {
    return false;
  }
}

export function setOn(on, stateFile = DEFAULT_STATE_FILE) {
  if (on) {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, 'on', 'utf8');
  } else {
    try {
      unlinkSync(stateFile);
    } catch {
      // already off
    }
  }
}

/** Command argument text -> 'report' | 'on' | 'off', or null for an unsupported word. */
export function parseInput(rawInput) {
  const arg = String(rawInput ?? '').trim().toLowerCase();
  if (!arg) return 'report';
  return arg === 'on' || arg === 'off' ? arg : null;
}

/** One human-readable status line, shared by the command result and the mount log. */
export function statusText(stateFile = DEFAULT_STATE_FILE) {
  return isOn(stateFile) ? 'ASD-STE100 mode is on.' : 'ASD-STE100 mode is off.';
}

/** Run one parsed command and return the `{ kind, text }` shape the registry validates. */
export function runCommand(rawInput, stateFile = DEFAULT_STATE_FILE) {
  const command = parseInput(rawInput);
  if (command === null) return { kind: 'error', text: USAGE };
  if (command === 'report') return { kind: 'success', text: statusText(stateFile) };
  setOn(command === 'on', stateFile);
  return { kind: 'success', text: statusText(stateFile) };
}

/** A whole message that is only the command line -> its argument text, else null. */
export function parseCommandLine(text) {
  const match = String(text ?? '').trim().match(/^[/@$]asd-?100(?:\s+(\S+))?$/i);
  if (!match) return null;
  return match[1] ?? '';
}

export function extractContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => typeof b?.text === 'string').map((b) => b.text).join('\n');
  }
  return '';
}

/** Text of every message, joined; used only by the command fallback. */
export function extractText(messages) {
  if (!Array.isArray(messages)) return '';
  return messages.map((m) => extractContent(m?.content)).filter(Boolean).join('\n').trim();
}

export function apply(ctx, config = {}) {
  const skillDir = resolveSkillDir(config.skillDir);
  const stateFile = config.stateFile || DEFAULT_STATE_FILE;
  const logger = ctx.logger ?? console;

  if (!ctx.systemPrompt || typeof ctx.systemPrompt.section !== 'function') {
    logger.warn('[dsh-asd-100] host has no systemPrompt service; plugin not mounted');
    return;
  }

  // order 55 sits after the persona prefix (0) and before the tool schemas (1000).
  // interpolate: false keeps the rule prose literal, so a `{{` a person writes into
  // their own SKILL.md is never read as a prompt-variable reference.
  ctx.systemPrompt.section({
    name: 'ste',
    order: 55,
    interpolate: false,
    text: () => (isOn(stateFile) ? renderSection(skillDir) : ''),
  });

  // `/asd100` through the command registry, when the composition has one.
  ctx.inject(['commands'], (child) => {
    child.commands.register({
      definitionId: 'dsh-asd-100',
      name: 'asd100',
      description: 'Turn ASD-STE100 simplified English output on or off',
      input: { hint: '[on|off]' },
      handler: (invocation) => runCommand(invocation.rawInput, stateFile),
    });
  });

  // The same command typed as a message. A registry-routed command never reaches
  // a step, so this listener sees only the lines the registry did not consume —
  // the headless runner, where no adapter parses slash input, for one. The loop
  // ends a turn that keeps no message, so a command-only message is replaced by
  // the status line the model can confirm.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    const messages = decision.messages ?? [];
    const commands = messages.map((message) => parseCommandLine(extractContent(message?.content)));
    if (!commands.some((command) => command !== null)) return decision;
    let reply = '';
    for (const command of commands) {
      if (command === null) continue;
      try {
        reply = runCommand(command, stateFile).text;
      } catch (err) {
        logger.warn('[dsh-asd-100] command failed: ' + String(err));
      }
    }
    const kept = messages.filter((_, index) => commands[index] === null);
    return {
      ...decision,
      messages: kept.length > 0 ? kept : [{ content: reply + ' Reply with one short confirmation.' }],
    };
  });

  logger.info(
    '[dsh-asd-100] mounted, ' +
      (isOn(stateFile) ? 'mode on' : 'mode off (run /asd100 on)') +
      ', skillDir: ' + skillDir,
  );
}

export default { name, inject, apply };
