// WHY: Abstracted safely through database workspace to support Prisma and JSON adapters.
export { upsertUser, userExists, userSessionExists, upsertUserSession, getUserName } from 'database';
