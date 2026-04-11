// WHY: Abstracted safely through database workspace to support Prisma and JSON adapters.
export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from 'database';
