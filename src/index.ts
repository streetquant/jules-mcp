#!/usr/bin/env node
/**
 * Jules MCP Server - Entry Point
 */

import { startServer } from './server.js';

process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
