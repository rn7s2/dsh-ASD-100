# dsh-ASD-100

Forces ASD-STE100 Simplified Technical English on every reply and every document.

## What it does

When the mode is on, the plugin adds an always-on section to the system prompt of
every request. The section holds the writing rules of simplified technical English:
20 words in a procedure sentence, 25 in a descriptive sentence, one instruction per
sentence, active voice, simple tenses, the condition before the command, one word
with one meaning, no semicolons, no em dashes, no contractions. A reply answers
first and uses prose only.

## Install

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-ASD-100
```

The command adds the package to the profile manifest and appends it to
`dsh.profile.bundles`. Restart DSH afterwards.

## Commands

- `/asd100 on` turns the mode on.
- `/asd100 off` turns the mode off.
- `/asd100` reports the current state.

`/asd-100` is accepted as an alias.

The command is registered with the host command registry, so it appears in the
`/` menu and never reaches the model. A composition with no slash-command adapter,
such as the headless runner, still accepts the command as a whole message: a
pre-step listener consumes the line, flips the mode, and replaces it with the status
line the model confirms.

## State

The mode is one flag file: `~/.dsh/dsh-asd-100/.active`. The plugin reads it on every
request, so all sessions share the state and a change takes effect at once. To turn
the mode off from outside the chat, delete the file.

## Where the rules come from

The rules ship with the plugin in `skills/simple-english/`, so a fresh install follows
the full rule set and the four reference files it points to. When
`~/.agents/skills/simple-english/SKILL.md` exists, that copy wins, and you can edit
your own rules there. When neither copy exists, the plugin uses a built-in rule set
of nine lines. All three paths are in `lib/index.js`.

## Config

Two optional fields, set in the bundle patch that loads the plugin:

```yaml
- insert:
    - id: dsh-asd-100
      name: dsh-asd-100
      config:
        skillDir: /path/to/simple-english   # default: ~/.agents/skills/simple-english, then the packaged copy
        stateFile: /path/to/.active         # default: ~/.dsh/dsh-asd-100/.active
```

## Compatibility

Built against DSH `0.2.1-rc.5` on Node 24. `package.json` declares both floors, and
DSH refuses to load a plugin whose declared `engines.dsh` range the runtime does not
satisfy.

The plugin needs one host service: `systemPrompt`. The command registry is optional.
Both paths use the current Cordis API: `ctx.systemPrompt.section({ name, order,
interpolate, text })`, `ctx.inject([...], (child) => …)`, and
`ctx.commands.register({ definitionId, name, description, input, handler })`.

## Development

```sh
node --test test/ste.test.mjs
```

The plugin imports node builtins only. It has no dependencies.

## Files

- `lib/index.js` — the plugin: the prompt section, the command, the flag file.
- `cordis.patch.yml` — the bundle patch that loads it.
- `skills/simple-english/` — the rule text and its references, spliced from the
  `simple-english` agent skill (MIT), version 2.1.1, standard ASD-STE100 Issue 9.
- `test/ste.test.mjs` — eleven tests.
- `awesome-dsh-plugin-entry.yml` — the list entry for the awesome-dsh-plugin PR.

## License

MIT
