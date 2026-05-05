/**
 * rules.ts — Cat-Bot command
 * Ported from GoatBot rules.js by NTKhang.
 *
 * Subcommands:
 *   rules                        — View all rules; reply with a number to zoom in
 *   rules <n>                    — View rule #n immediately
 *   rules add <text>             — Add a rule (admin only)
 *   rules edit <n> <text>        — Edit rule #n (admin only)
 *   rules move <n1> <n2>         — Swap rule #n1 and #n2 (admin only)
 *   rules delete <n>             — Delete rule #n (admin only)
 *   rules remove                 — Remove all rules with confirmation (admin only)
 *                                  Discord/Telegram → Confirm/Cancel buttons
 *                                  Facebook        → emoji reaction (any listed emoji)
 *
 * DB path:
 *   db.threads.collection(threadID) → 'rules' collection → key 'list' → string[]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ─── State labels ─────────────────────────────────────────────────────────────

const STATE = {
  view_rule: 'view_rule',
} as const;

// ─── Emoji allowlist for "remove all" confirmation (FB platforms only) ────────
// ⚠️ GAP: Original accepted ANY emoji. Cat-Bot requires a static allowlist.
const CONFIRM_EMOJIS = [
  '✅',
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '😡',
  '🔥',
  '🎉',
  '😍',
  '⭐',
  '💯',
] as const;

// ─── Button IDs (Discord & Telegram only) ─────────────────────────────────────

const BUTTON_ID = {
  confirmRemove: 'confirm_remove',
  cancelRemove: 'cancel_remove',
} as const;

/** Stored in button context so onClick knows which thread to clear. */
interface ButtonRemoveContext extends Record<string, unknown> {
  threadID: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export const config = {
  name: 'rules',
  version: '1.7.0',
  role: Role.ANYONE,
  author: 'NTKhang (Cat-Bot port)',
  description: 'Create/view/add/edit/move/delete group rules',
  cooldown: 5,
  hasPrefix: true,
  category: 'thread',
  usage: [
    '— View all group rules (reply with # to zoom in)',
    '<n> — View rule #n directly',
    'add <rule text> — Add a new rule (admin only)',
    'edit <n> <new content> — Edit rule #n (admin only)',
    'move <n1> <n2> — Swap rules #n1 and #n2 (admin only)',
    'delete <n> — Delete rule #n (admin only)',
    'remove — Remove ALL rules with confirmation (admin only)',
  ],
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ─── Platform helper ──────────────────────────────────────────────────────────

function isButtonPlatform(platform: string): boolean {
  return platform === Platforms.Discord || platform === Platforms.Telegram;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function getRulesList(
  db: AppCtx['db'],
  threadID: string,
): Promise<string[]> {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('rules')))
    await coll.createCollection('rules');
  const handle = await coll.getCollection('rules');
  return ((await handle.get('list')) as string[] | null) ?? [];
}

async function saveRulesList(
  db: AppCtx['db'],
  threadID: string,
  list: string[],
): Promise<void> {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('rules')))
    await coll.createCollection('rules');
  const handle = await coll.getCollection('rules');
  await handle.set('list', list);
}

// ─── Admin check ─────────────────────────────────────────────────────────────

async function isThreadAdmin(
  thread: AppCtx['thread'],
  senderID: string,
): Promise<boolean> {
  try {
    const info = (await thread.getInfo()) as unknown as Record<string, unknown>;
    const adminIDs = info['adminIDs'] as
      | Array<string | { uid: string }>
      | undefined;
    if (!Array.isArray(adminIDs)) return false;
    return adminIDs.some(
      (a) => (typeof a === 'string' ? a : a.uid) === senderID,
    );
  } catch {
    return false;
  }
}

// ─── Button definitions (Discord & Telegram: remove confirmation) ─────────────

export const button = {
  // ── ✅ Confirm ─────────────────────────────────────────────────────────────
  [BUTTON_ID.confirmRemove]: {
    label: '✅ Confirm',
    style: ButtonStyle.DANGER,
    onClick: async ({
      chat,
      event,
      session,
      button: btn,
      db,
    }: AppCtx): Promise<void> => {
      const ctx = session.context as Partial<ButtonRemoveContext>;
      const threadID = ctx.threadID ?? (event['threadID'] as string);

      // Clean up context — prevents stale re-clicks
      btn.deleteContext(session.id);

      await saveRulesList(db, threadID, []);

      // Editing without a `button` field removes the inline keyboard on Discord & Telegram
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: '✅ All group rules have been removed successfully.',
      });
    },
  },

  // ── ❌ Cancel ──────────────────────────────────────────────────────────────
  [BUTTON_ID.cancelRemove]: {
    label: '❌ Cancel',
    style: ButtonStyle.SECONDARY,
    onClick: async ({
      chat,
      event,
      session,
      button: btn,
    }: AppCtx): Promise<void> => {
      btn.deleteContext(session.id);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: '↩️ Rule removal cancelled.',
      });
    },
  },
};

// ─── Command handler ──────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  thread,
  state,
  native,
  button: btn,
  prefix,
  usage,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;
  const rulesList = await getRulesList(db, threadID);
  const total = rulesList.length;
  const type = args[0];

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  // ── No subcommand: view all rules ──────────────────────────────────────────
  if (!type) {
    const body =
      total === 0
        ? `Your group has no rules yet. Use \`${prefix}rules add <rule>\` to add one.`
        : `**Group Rules:**\n${rulesList.map((r, i) => `${i + 1}. ${r}`).join('\n')}` +
          `\n\n_Reply to this message with a rule number to view it in detail._`;

    const msgId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: body,
    });

    if (msgId) {
      state.create({
        id: state.generateID({ id: String(msgId) }),
        state: STATE.view_rule,
        context: { botMsgId: String(msgId), prefix },
      });
    }
    return;
  }

  // ── add / -a ───────────────────────────────────────────────────────────────
  if (['add', '-a'].includes(type)) {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({ message: '❌ Only admins can add rules.' });
      return;
    }
    if (!args[1]) {
      await chat.replyMessage({
        message: '⚠️ Please enter the content for the rule you want to add.',
      });
      return;
    }
    rulesList.push(args.slice(1).join(' '));
    await saveRulesList(db, threadID, rulesList);
    await chat.replyMessage({ message: '✅ New rule added successfully.' });
    return;
  }

  // ── edit / -e ──────────────────────────────────────────────────────────────
  if (['edit', '-e'].includes(type)) {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({ message: '❌ Only admins can edit rules.' });
      return;
    }
    const stt = parseInt(args[1] ?? '');
    if (isNaN(stt)) {
      await chat.replyMessage({
        message: '⚠️ Please enter the number of the rule you want to edit.',
      });
      return;
    }
    if (!rulesList[stt - 1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Rule #${stt} does not exist. ${total === 0 ? 'No rules have been set.' : `Group has ${total} rule(s).`}`,
      });
      return;
    }
    if (!args[2]) {
      await chat.replyMessage({
        message: `⚠️ Please enter the new content for rule #${stt}.`,
      });
      return;
    }
    const newContent = args.slice(2).join(' ');
    rulesList[stt - 1] = newContent;
    await saveRulesList(db, threadID, rulesList);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Rule #${stt} updated to: _${newContent}_`,
    });
    return;
  }

  // ── move / -m ──────────────────────────────────────────────────────────────
  if (['move', '-m'].includes(type)) {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({ message: '❌ Only admins can reorder rules.' });
      return;
    }
    const n1 = parseInt(args[1] ?? '');
    const n2 = parseInt(args[2] ?? '');
    if (isNaN(n1) || isNaN(n2)) {
      await chat.replyMessage({
        message: '⚠️ Please enter the numbers of the 2 rules to swap.',
      });
      return;
    }
    if (n1 === n2) {
      await chat.replyMessage({
        message: '⚠️ Cannot swap a rule with itself.',
      });
      return;
    }
    const missing = [n1, n2].filter((n) => !rulesList[n - 1]);
    if (missing.length) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Rule(s) #${missing.join(' and #')} do not exist. ${total === 0 ? 'No rules have been set.' : `Group has ${total} rule(s).`}`,
      });
      return;
    }
    // ── FIX: use a temp variable + non-null assertions to satisfy TS ──────────
    // rulesList[n] is string | undefined; the missing[] guard above proves both
    // indices exist, so the non-null assertions are safe here.
    const tmp = rulesList[n2 - 1]!;
    rulesList[n2 - 1] = rulesList[n1 - 1]!;
    rulesList[n1 - 1] = tmp;
    await saveRulesList(db, threadID, rulesList);
    await chat.replyMessage({
      message: `✅ Swapped rule #${n1} and rule #${n2} successfully.`,
    });
    return;
  }

  // ── delete / del / -d ──────────────────────────────────────────────────────
  if (['delete', 'del', '-d'].includes(type)) {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({ message: '❌ Only admins can delete rules.' });
      return;
    }
    const n = parseInt(args[1] ?? '');
    if (isNaN(n)) {
      await chat.replyMessage({
        message: '⚠️ Please enter the number of the rule to delete.',
      });
      return;
    }
    if (!rulesList[n - 1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Rule #${n} does not exist. ${total === 0 ? 'No rules have been set.' : `Group has ${total} rule(s).`}`,
      });
      return;
    }
    const deleted = rulesList.splice(n - 1, 1)[0];
    await saveRulesList(db, threadID, rulesList);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Deleted rule #${n}: _${deleted}_`,
    });
    return;
  }

  // ── remove / reset / -r / -rm ─────────────────────────────────────────────
  if (['remove', 'reset', '-r', '-rm'].includes(type)) {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({
        message: '❌ Only admins can remove all group rules.',
      });
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // BRANCH A — Discord & Telegram: Confirm / Cancel inline buttons
    // ════════════════════════════════════════════════════════════════════════
    if (isButtonPlatform(native.platform)) {
      const confirmId = btn.generateID({
        id: BUTTON_ID.confirmRemove,
        public: false,
      });
      const cancelId = btn.generateID({
        id: BUTTON_ID.cancelRemove,
        public: false,
      });

      const ctx: ButtonRemoveContext = { threadID };
      btn.createContext({ id: confirmId, context: ctx });
      btn.createContext({ id: cancelId, context: ctx });

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ Are you sure you want to remove **all** group rules? This cannot be undone.',
        button: [confirmId, cancelId],
      });
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // BRANCH B — Facebook Messenger & Facebook Page: emoji reaction flow
    // ════════════════════════════════════════════════════════════════════════
    const msgId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ React to this message with any of these emojis to confirm removing **all** group rules:\n${CONFIRM_EMOJIS.join(' ')}`,
    });
    if (msgId) {
      state.create({
        id: state.generateID({ id: String(msgId) }),
        state: [...CONFIRM_EMOJIS],
        context: {},
      });
    }
    return;
  }

  // ── <number> — view specific rule(s) by position ──────────────────────────
  if (!isNaN(Number(type))) {
    const lines: string[] = [];
    for (const sttStr of args) {
      const n = parseInt(sttStr);
      if (!isNaN(n) && rulesList[n - 1])
        lines.push(`${n}. ${rulesList[n - 1]}`);
    }
    if (!lines.length) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Rule #${type} does not exist. ${total === 0 ? 'No rules have been set.' : `Group has ${total} rule(s).`}`,
      });
      return;
    }
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
    });
    return;
  }

  // ── Unrecognised subcommand ───────────────────────────────────────────────
  return usage();
};

// ─── onReply ──────────────────────────────────────────────────────────────────

export const onReply = {
  [STATE.view_rule]: async ({
    chat,
    session,
    event,
    state: stateApi,
    db,
  }: AppCtx): Promise<void> => {
    stateApi.delete(session.id);

    const { botMsgId, prefix } = session.context as {
      botMsgId: string;
      prefix: string;
    };
    const threadID = event['threadID'] as string;
    const body = (event['message'] as string | undefined) ?? '';

    const num = parseInt(body);
    if (isNaN(num) || num < 1) {
      await chat.replyMessage({
        message: '⚠️ Please enter a valid rule number.',
      });
      return;
    }

    const rulesList = await getRulesList(db, threadID);
    const total = rulesList.length;

    if (!rulesList[num - 1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Rule #${num} does not exist. ${
          total === 0
            ? `No rules have been set. Use \`${prefix}rules add\`.`
            : `Group has ${total} rule(s).`
        }`,
      });
      return;
    }

    await chat.replyMessage({ message: `${num}. ${rulesList[num - 1]}` });
    await chat.unsendMessage(botMsgId);
  },
};

// ─── onReact (Facebook Messenger & Facebook Page only) ────────────────────────
// ⚠️ GAP: Only emojis in CONFIRM_EMOJIS trigger this — not truly "any emoji".

const handleConfirmRemove = async ({
  chat,
  session,
  state: stateApi,
  db,
  event,
}: AppCtx): Promise<void> => {
  stateApi.delete(session.id);
  const threadID = event['threadID'] as string;
  await saveRulesList(db, threadID, []);
  await chat.replyMessage({
    message: '✅ All group rules have been removed successfully.',
  });
};

export const onReact: Record<string, (ctx: AppCtx) => Promise<void>> =
  Object.fromEntries(
    CONFIRM_EMOJIS.map((emoji) => [emoji, handleConfirmRemove]),
  );
