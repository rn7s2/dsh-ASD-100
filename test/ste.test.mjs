import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  apply,
  extractText,
  isOn,
  parseCommandLine,
  parseInput,
  readBody,
  renderSection,
  resolveSkillDir,
  runCommand,
  setOn,
  stripFrontmatter,
} from '../lib/index.js';

test('stripFrontmatter drops the YAML block', () => {
  assert.equal(stripFrontmatter('---\nname: x\n---\nbody\n'), 'body\n');
  assert.equal(stripFrontmatter('body only'), 'body only');
});

test('parseInput reads the on, off, and report forms and refuses the rest', () => {
  assert.equal(parseInput('on'), 'on');
  assert.equal(parseInput(' OFF '), 'off');
  assert.equal(parseInput(''), 'report');
  assert.equal(parseInput(undefined), 'report');
  assert.equal(parseInput('maybe'), null);
});

test('parseCommandLine accepts the /asd100 spellings and refuses prose', () => {
  assert.equal(parseCommandLine('/asd100 on'), 'on');
  assert.equal(parseCommandLine('/ASD-100 OFF'), 'OFF');
  assert.equal(parseCommandLine('/asd100'), '');
  assert.equal(parseCommandLine('/asd100 maybe'), 'maybe');
  assert.equal(parseCommandLine('asd100 on'), null);
  assert.equal(parseCommandLine('/ste on'), null);
  assert.equal(parseCommandLine('/asd100 on and then do the thing'), null);
  assert.equal(parseCommandLine(''), null);
});

test('extractText joins the text blocks of a message list', () => {
  assert.equal(extractText([{ content: '/asd100 on' }, { content: [{ type: 'text', text: 'more' }] }]), '/asd100 on\nmore');
});

test('resolveSkillDir takes the first candidate that has a SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asd-100-skill-'));
  try {
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: x\n---\nrules\n');
    assert.equal(resolveSkillDir(dir), dir, 'the explicit dir wins');
    const fallback = resolveSkillDir(join(dir, 'missing'));
    assert.notEqual(fallback, join(dir, 'missing'), 'a missing dir is not returned');
    assert.ok(readBody(fallback), 'the fallback dir holds rules');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the packaged rules ship with the plugin', () => {
  const text = renderSection(resolveSkillDir(join(tmpdir(), 'asd-100-missing-skill')));
  assert.match(text, /ASD-STE100/, 'the vendored SKILL.md must be found');
});

test('renderSection falls back to the built-in rules', () => {
  assert.match(renderSection(join(tmpdir(), 'asd-100-nowhere')), /20 words at most/);
});

test('runCommand flips the flag file and reports the state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asd-100-cmd-'));
  const stateFile = join(dir, 'nested', '.active');
  try {
    assert.deepEqual(runCommand('', stateFile), { kind: 'success', text: 'ASD-STE100 mode is off.' });
    assert.deepEqual(runCommand('on', stateFile), { kind: 'success', text: 'ASD-STE100 mode is on.' });
    assert.equal(isOn(stateFile), true);
    assert.deepEqual(runCommand('off', stateFile), { kind: 'success', text: 'ASD-STE100 mode is off.' });
    assert.equal(isOn(stateFile), false);
    assert.deepEqual(runCommand('maybe', stateFile), { kind: 'error', text: 'Usage: /asd100 [on|off]' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A host stub with the services the plugin reads, recording what it registers. */
function hostStub() {
  const sections = [];
  const commands = [];
  const listeners = new Map();
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    systemPrompt: { section: (section) => sections.push(section) },
    inject: (deps, callback) => {
      assert.deepEqual(deps, ['commands']);
      callback({ commands: { register: (definition) => commands.push(definition) } });
    },
    on: (event, listener) => listeners.set(event, listener),
  };
  return { ctx, sections, commands, listeners };
}

test('the flag file gates the injected section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asd-100-'));
  const stateFile = join(dir, 'nested', '.active');
  try {
    const { ctx, sections } = hostStub();
    apply(ctx, { stateFile, skillDir: join(dir, 'missing-skill') });

    assert.equal(sections.length, 1);
    assert.equal(sections[0].name, 'ste');
    assert.equal(sections[0].interpolate, false, 'rule prose must never be read as a prompt variable');
    assert.equal(sections[0].text(), '', 'off by default');

    setOn(true, stateFile);
    assert.equal(isOn(stateFile), true);
    const on = sections[0].text();
    assert.match(on, /^STE ACTIVE/);
    assert.match(on, /ASD-STE100/, 'the shipped rules are used when the configured dir is missing');

    setOn(false, stateFile);
    assert.equal(sections[0].text(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the plugin registers /asd100 with the command registry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asd-100-reg-'));
  const stateFile = join(dir, '.active');
  try {
    const { ctx, commands } = hostStub();
    apply(ctx, { stateFile, skillDir: join(dir, 'missing-skill') });

    assert.equal(commands.length, 1);
    const [definition] = commands;
    assert.equal(definition.name, 'asd100');
    assert.equal(definition.definitionId, 'dsh-asd-100');
    assert.ok(definition.description.length > 0, 'the registry rejects an empty description');
    assert.equal(typeof definition.input.hint, 'string');

    assert.equal(definition.handler({ rawInput: 'on', attachments: [], signal: new AbortController().signal }).kind, 'success');
    assert.equal(isOn(stateFile), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pre-step fallback consumes the command line when no registry exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asd-100-step-'));
  const stateFile = join(dir, '.active');
  try {
    const sections = [];
    const listeners = new Map();
    const ctx = {
      logger: { info() {}, warn() {}, debug() {} },
      systemPrompt: { section: (section) => sections.push(section) },
      inject: () => {},
      on: (event, listener) => listeners.set(event, listener),
    };
    apply(ctx, { stateFile, skillDir: join(dir, 'missing-skill') });

    const preStep = listeners.get('agent/pre-step');
    assert.equal(typeof preStep, 'function');

    const kept = { content: 'please refactor this' };
    const decision = { kind: 'enter', messages: [{ content: '/asd100 on' }, kept] };
    const result = await preStep({}, async () => decision);

    assert.deepEqual(result.messages, [kept], 'the command line never reaches the model');
    assert.equal(isOn(stateFile), true);
    assert.match(sections[0].text(), /^STE ACTIVE/);

    // A command-only message would leave the turn with no message, so the mode
    // report replaces it; otherwise the loop ends the turn with no reply.
    const alone = await preStep({}, async () => ({ kind: 'enter', messages: [{ content: '/asd100' }] }));
    assert.equal(alone.messages.length, 1);
    assert.match(alone.messages[0].content, /ASD-STE100 mode is on/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
