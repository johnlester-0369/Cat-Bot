// WHY: Abstracted safely through database workspace to support Prisma and JSON adapters.
export { upsertThread, threadExists, threadSessionExists, upsertThreadSession, isThreadAdmin, getThreadName, getThreadSessionData, setThreadSessionData, getAllGroupThreadIds, getThreadSessionUpdatedAt } from 'database';
