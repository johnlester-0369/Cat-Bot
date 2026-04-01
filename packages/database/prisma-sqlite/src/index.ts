// Single import point for all consumers in the monorepo.
// Consumers do: import { prisma, type User } from 'database'
// They never reference the generated/ or internal client paths directly — this
// decouples them from Prisma's internal file layout and makes client upgrades transparent.
export { prisma } from './client.js';

// Re-export all generated types (User, Post, Prisma namespace, etc.) so consumers
// get full TypeScript safety without taking a direct dependency on the generated output path
export * from './generated/prisma/client.js';