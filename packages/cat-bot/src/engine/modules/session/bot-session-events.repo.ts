// WHY: Abstracted safely through database workspace to support Prisma and JSON adapters.
export { upsertSessionEvents, findSessionEvents, setEventEnabled, isEventEnabled } from 'database';