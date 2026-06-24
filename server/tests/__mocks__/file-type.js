// Stub for the ESM-only `file-type` package so Jest (CommonJS) can load the
// upload middleware. Avatar-upload MIME sniffing is not exercised in the suite.
module.exports = {
  fromBuffer: async () => null,
};
