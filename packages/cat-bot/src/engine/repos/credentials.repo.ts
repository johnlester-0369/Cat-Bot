// WHY: Abstracted safely through database workspace to support Prisma and JSON adapters.
export { 
  findDiscordCredentialState, updateDiscordCredentialCommandHash, findAllDiscordCredentials,
  findTelegramCredentialState, updateTelegramCredentialCommandHash, findAllTelegramCredentials,
  findAllFbPageCredentials, findAllFbMessengerCredentials, findAllBotSessions, isBotAdmin,
  addBotAdmin, removeBotAdmin, listBotAdmins, updateBotSessionPrefix,
} from 'database';
