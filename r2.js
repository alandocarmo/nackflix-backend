const { S3Client } = require("@aws-sdk/client-s3");

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

module.exports = { getR2Client };
