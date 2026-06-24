module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 30000,
  // file-type@18 is ESM-only; stub it so the CommonJS test runner can load
  // the upload middleware.
  moduleNameMapper: {
    '^file-type$': '<rootDir>/tests/__mocks__/file-type.js',
  },
  // Surface open handles but don't fail on them; mongodb-memory-server cleans up in setup.
  forceExit: true,
};
