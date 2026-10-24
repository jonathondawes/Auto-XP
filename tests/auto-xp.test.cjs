const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ mode = 'automatic', system = 'dnd5e', notify = true } = {}) {
    const hooks = new Map();
    const settings = new Map();
    const messages = [];
    const actors = new Map();
    const notices = [];
    const gm = { id: 'gm1', isGM: true, active: true };
    const users = [gm, { id: 'gm2', isGM: true, active: true }];
    users.activeGM = gm;
    const game = {
        user: gm, users, messages, system: { id: system },
        settings: {
            register(module, key, definition) { settings.set(key, definition.default); },
            get(module, key) { return settings.get(key); },
        },
        actors: { get: id => actors.get(`Actor.${id}`) },
        socket: { on() {}, emit() {} },
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, game, HTMLElement: class {},
        Hooks: {
            once(key, fn) { hooks.set(key, [...(hooks.get(key) ?? []), fn]); },
            on(key, fn) { hooks.set(key, [...(hooks.get(key) ?? []), fn]); },
        },
        ui: { notifications: Object.fromEntries(['info', 'warn', 'error'].map(key => [key, text => notices.push(text)])) },
        fromUuid: async uuid => actors.get(uuid),
        ChatMessage: { async create(data) {
            const message = {
                id: `message${messages.length + 1}`, ...structuredClone(data),
                getFlag(module, key) { return this.flags?.[module]?.[key]; },
                async update(update) {
                    if (this.failNextSave) { this.failNextSave = false; throw new Error('Message write failed'); }
                    for (const [key, value] of Object.entries(update)) setPath(this, key, structuredClone(value));
                },
            };
            messages.push(message);
            return message;
        } },
    });
    vm.runInContext(fs.readFileSync('scripts/auto-xp.js', 'utf8'), context);
    hooks.get('init').forEach(fn => fn());
    settings.set('award-mode', mode);
    settings.set('notify-players', notify);
    settings.set('dnd5e-encounter-multiplier', false);
    hooks.get('ready').forEach(fn => fn());
    function actor(id, xp = 100) {
        const value = {
            id, uuid: `Actor.${id}`, name: id, type: 'character', hasPlayerOwner: true,
            system: { details: { xp: { value: xp }, level: system === 'pf2e' ? { value: 1 } : 1 } },
            flags: {}, writes: 0,
            getFlag(module, key) { return this.flags?.[module]?.[key]; },
            async update(update) {
                if (this.fail) throw new Error('Actor write failed');
                for (const [key, value] of Object.entries(update)) setPath(this, key, structuredClone(value));
                this.writes++;
                if (this.afterWrite) this.afterWrite();
            },
        };
        actors.set(value.uuid, value);
        return value;
    }
    function combat(players, id = 'combat1') {
        return {
            id, flags: {}, metrics: { award: { xp: 80 } },
            combatants: [...players.map(actor => ({ actor })), {
                id: 'enemy', defeated: true,
                actor: { type: 'npc', system: { details: { xp: { value: 200 } } } },
            }],
            getFlag(module, key) { return this.flags[key]; },
            async setFlag(module, key, value) { this.flags[key] = value; },
        };
    }
    const run = code => vm.runInContext(code, context);
    async function process(combat) { context.testCombat = combat; await run('processCombatXP(testCombat)'); }
    async function action(message, action, amount) {
        Object.assign(context, { testMessage: message, testAction: action, testAmount: amount });
        return run('queueAwardAction(() => performAwardAction(testMessage, testAction, testAmount))');
    }
    return { game, actor, combat, process, action, messages, actors, settings, notices, context, run, hooks };
}
function setPath(object, path, value) {
    const keys = path.split('.');
    for (const key of keys.slice(0, -1)) object = object[key] ??= {};
    object[keys.at(-1)] = value;
}
const xp = actor => actor.system.details.xp.value;
const ledger = message => message.getFlag('auto-xp', 'award');

test('automatic is default; undo preserves XP earned later and cannot repeat', async () => {
    const env = setup();
    const actor = env.actor('hero');
    const combat = env.combat([actor]);
    await env.process(combat);
    assert.equal(xp(actor), 300);
    const message = env.messages[0];
    assert.equal(ledger(message).status, 'awarded');
    actor.system.details.xp.value += 50;
    await env.action(message, 'undo');
    await env.action(message, 'undo');
    assert.equal(xp(actor), 150);
    assert.equal(ledger(message).status, 'undone');
    await env.process(combat);
    assert.equal(env.messages.length, 1);
});

test('review stays GM-only and supports edited partial XP', async () => {
    const env = setup({ mode: 'review' });
    const actor = env.actor('hero');
    await env.process(env.combat([actor]));
    const message = env.messages[0];
    assert.equal(xp(actor), 100);
    assert.equal(ledger(message).status, 'pending');
    assert.deepEqual(message.whisper, ['gm1', 'gm2']);
    await env.action(message, 'award', '45');
    await env.action(message, 'award', '45');
    assert.equal(xp(actor), 145);
    assert.deepEqual(Array.from(message.whisper), []);
});

test('discard and zero XP leave character sheets unchanged', async () => {
    for (const action of ['discard', 'award']) {
        const env = setup({ mode: 'review' });
        const actor = env.actor('hero');
        const combat = env.combat([actor]);
        await env.process(combat);
        await env.action(env.messages[0], action, '0');
        await env.process(combat);
        assert.equal(xp(actor), 100);
        assert.equal(env.messages.length, 1);
        await env.action(env.messages[0], 'award', '100');
        assert.equal(xp(actor), 100);
    }
});

test('blank, negative, fractional, infinite and unsafe review amounts are rejected', async () => {
    const env = setup({ mode: 'review' });
    const actor = env.actor('hero');
    await env.process(env.combat([actor]));
    for (const invalid of ['', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992']) {
        await assert.rejects(env.action(env.messages[0], 'award', invalid));
        assert.equal(ledger(env.messages[0]).status, 'pending');
        assert.equal(xp(actor), 100);
    }
});

test('duplicate end/delete hooks produce a single award even without combat flags', async () => {
    const env = setup();
    const actor = env.actor('hero');
    const combat = env.combat([actor]);
    combat.setFlag = async () => { throw new Error('Combat deleted'); };
    await Promise.all([env.process(combat), env.process(combat)]);
    await env.process(combat);
    assert.equal(xp(actor), 300);
    assert.equal(env.messages.length, 1);
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(actor), 100);
});

test('non-authority GMs and players cannot award, undo or discard', async () => {
    const env = setup({ mode: 'review' });
    const actor = env.actor('hero');
    const combat = env.combat([actor]);
    await env.process(combat);
    for (const user of [env.game.users[1], { id: 'player', isGM: false }]) {
        env.game.user = user;
        await env.process(env.combat([actor], 'anotherCombat'));
        for (const action of ['award', 'undo', 'discard']) await env.action(env.messages[0], action, '50');
        assert.equal(xp(actor), 100);
        assert.equal(ledger(env.messages[0]).status, 'pending');
        assert.equal(env.messages.length, 1);
    }
});

test('partial actor failure retries only missing awards', async () => {
    const env = setup();
    const a = env.actor('one'), b = env.actor('two');
    b.fail = true;
    await env.process(env.combat([a, b]));
    assert.equal(xp(a), 200);
    assert.equal(xp(b), 100);
    assert.equal(ledger(env.messages[0]).status, 'applying');
    b.fail = false;
    await env.action(env.messages[0], 'award');
    assert.equal(xp(a), 200);
    assert.equal(xp(b), 200);
    assert.equal(a.writes, 1);
    assert.equal(ledger(env.messages[0]).status, 'awarded');
});

test('receipt recovers a failed ledger write without double-awarding', async () => {
    const env = setup();
    const actor = env.actor('hero');
    actor.afterWrite = () => { env.messages[0].failNextSave = true; actor.afterWrite = null; };
    await env.process(env.combat([actor]));
    assert.equal(xp(actor), 300);
    assert.equal(ledger(env.messages[0]).status, 'applying');
    await env.action(env.messages[0], 'award');
    assert.equal(xp(actor), 300);
    assert.equal(actor.writes, 1);
    assert.equal(ledger(env.messages[0]).status, 'awarded');
});

test('undo failure can be retried without subtracting twice', async () => {
    const env = setup();
    const a = env.actor('one'), b = env.actor('two');
    await env.process(env.combat([a, b]));
    b.fail = true;
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(a), 100);
    assert.equal(xp(b), 200);
    b.fail = false;
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(a), 100);
    assert.equal(xp(b), 100);
    assert.equal(ledger(env.messages[0]).status, 'undone');
});

test('undo refuses negative totals and allows retry after correction', async () => {
    const env = setup();
    const actor = env.actor('hero');
    await env.process(env.combat([actor]));
    actor.system.details.xp.value = 50;
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(actor), 50);
    assert.equal(ledger(env.messages[0]).status, 'undoing');
    actor.system.details.xp.value = 250;
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(actor), 50);
});

test('PF2e uses per-character XP and supports review/undo; private awards remain private', async () => {
    const env = setup({ mode: 'review', system: 'pf2e', notify: false });
    const a = env.actor('one'), b = env.actor('two');
    await env.process(env.combat([a, b]));
    assert.equal(ledger(env.messages[0]).amount, 80);
    await env.action(env.messages[0], 'award', '40');
    assert.equal(xp(a), 140);
    assert.equal(xp(b), 140);
    assert.deepEqual(Array.from(env.messages[0].whisper), ['gm1', 'gm2']);
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(a), 100);
    assert.equal(xp(b), 100);
});

test('invalid multipliers do not touch actors or create a ledger', async () => {
    for (const multiplier of [-1, Infinity, NaN]) {
        const env = setup();
        const actor = env.actor('hero');
        env.settings.set('xp-multiplier', multiplier);
        await env.process(env.combat([actor]));
        assert.equal(xp(actor), 100);
        assert.equal(env.messages.length, 0);
        assert.ok(env.notices.length);
    }
});

test('card content escapes character names and attributes', () => {
    const env = setup();
    env.context.data = { amount: 10, status: 'pending', entries: [
        { name: '<script>bad</script>', img: 'x" onerror="bad', state: 'pending' },
    ] };
    const html = env.run('renderAwardCard(data)');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('x&quot; onerror=&quot;bad'));
});

test('persisted award can be undone in a fresh session after encounter deletion', async () => {
    const before = setup();
    const actor = before.actor('hero');
    await before.process(before.combat([actor]));
    const original = before.messages[0];
    const after = setup();
    const restored = after.actor('hero', xp(actor) + 25);
    restored.flags = structuredClone(actor.flags);
    after.context.snapshot = {
        content: original.content, whisper: Array.from(original.whisper),
        flags: structuredClone(original.flags),
    };
    const message = await after.run('ChatMessage.create(snapshot)');
    await after.action(message, 'undo');
    assert.equal(xp(restored), 125);
    assert.equal(ledger(message).status, 'undone');
});

test('partial awards can be undone without applying the remaining award', async () => {
    const env = setup();
    const a = env.actor('one'), b = env.actor('two');
    b.fail = true;
    await env.process(env.combat([a, b]));
    await env.action(env.messages[0], 'undo');
    assert.equal(xp(a), 100);
    assert.equal(xp(b), 100);
    assert.equal(ledger(env.messages[0]).status, 'undone');
});

test('chat controls support both render hooks and ignore rapid repeat clicks', async () => {
    for (const legacy of [false, true]) {
        const env = setup({ mode: 'review' });
        const actor = env.actor('hero');
        await env.process(env.combat([actor]));
        const button = { disabled: false, dataset: { autoXpAction: 'award' } };
        const input = { disabled: false, value: '30' };
        let listener, bindings = 0;
        const controls = {
            dataset: {}, hidden: true,
            querySelectorAll: () => [button, input], querySelector: () => input,
            addEventListener(type, callback) { listener = callback; bindings++; },
        };
        const root = new env.context.HTMLElement();
        root.querySelector = () => controls;
        const html = legacy ? [root] : root;
        for (const hook of ['renderChatMessage', 'renderChatMessageHTML']) {
            env.hooks.get(hook).forEach(fn => fn(env.messages[0], html));
        }
        assert.equal(controls.hidden, false);
        assert.equal(bindings, 1);
        const event = { target: { closest: () => button } };
        listener(event);
        listener(event);
        await env.run('_awardQueue');
        assert.equal(xp(actor), 130);
        assert.equal(actor.writes, 1);
    }
});

test('chat controls remain hidden for players and disabled for other GMs', async () => {
    const env = setup({ mode: 'review' });
    const actor = env.actor('hero');
    await env.process(env.combat([actor]));
    for (const user of [{ id: 'player', isGM: false }, env.game.users[1]]) {
        env.game.user = user;
        const button = { disabled: false };
        const controls = {
            dataset: {}, hidden: true,
            querySelectorAll: () => [button], addEventListener() {},
        };
        const root = new env.context.HTMLElement();
        root.querySelector = () => controls;
        env.hooks.get('renderChatMessageHTML')[0](env.messages[0], root);
        assert.equal(controls.hidden, !user.isGM);
        if (user.isGM) assert.equal(button.disabled, true);
    }
});
