// WHY: Abstracted safely through database workspace to support Prisma and JSON adapters.
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from 'database';
