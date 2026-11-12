import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ResumeStorage } from "./contracts";

/** Private S3-compatible storage. Neon Object Storage requires path-style addressing. */
export class S3FileStorage implements ResumeStorage {
  readonly name = "private S3-compatible object storage";
  private readonly bucket = process.env.OBJECT_STORAGE_BUCKET || "assets";
  private readonly client: S3Client;

  constructor() {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3 || process.env.OBJECT_STORAGE_ENDPOINT;
    const region = process.env.AWS_REGION || "us-east-1";
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.OBJECT_STORAGE_ACCESS_KEY;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.OBJECT_STORAGE_SECRET_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("S3 storage requires AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.");
    }
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) {
      throw new Error("S3 storage endpoint must be an HTTPS URL without credentials or query parameters.");
    }
    this.client = new S3Client({
      endpoint: parsedEndpoint.origin,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private validateKey(key: string) {
    if (!/^users\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid private file key");
  }

  async save(input: { ownerId: string; fileName: string; contentType: string; bytes: Buffer }) {
    const key = `users/${input.ownerId}/${crypto.randomUUID()}`;
    this.validateKey(key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: input.bytes,
      ContentType: input.contentType,
      Metadata: { "file-name": encodeURIComponent(input.fileName) },
    }));
    return { key, size: input.bytes.length };
  }

  async read(key: string) {
    this.validateKey(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error("Stored file has no response body");
    const encodedName = response.Metadata?.["file-name"] || "download";
    return {
      bytes: Buffer.from(await response.Body.transformToByteArray()),
      contentType: response.ContentType || "application/octet-stream",
      fileName: decodeURIComponent(encodedName),
    };
  }

  async remove(key: string) {
    this.validateKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
