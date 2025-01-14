import formidable from 'formidable-serverless';
import { connectDB } from '@/src/db';
import MyFileModel from "@/src/models/myFile";
import slugify from 'slugify';
import pinecone, { initialize } from "@/src/pinecone";
import { s3Upload } from "@/src/s3services";

export const config = {
  api: {
    bodyParser: false, // Disable default body parsing
  },
};

// Function to create a Pinecone index
const createIndex = async (indexName) => {
  const response = await pinecone.listIndexes();
  const indexes = response?.indexes || []; // Extract indexes from the response
  if (!indexes.includes(indexName)) {
    await pinecone.createIndex({
      name: indexName,
      dimension: 768, // OpenAI embeddings dimension
	  spec: {
		serverless: {
		  cloud: 'aws',
		  region: 'us-east-1',
		},
	  },
    });
    console.log("Index created:", indexName);
  } else {
    console.log(`Index with name ${indexName} already exists`);
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Connect to MongoDB
    await connectDB();

    // Parse the incoming form data
    const form = new formidable.IncomingForm();

    form.parse(req, async (error, fields, files) => {
      if (error) {
        console.error("Form parsing error:", error);
        return res.status(500).json({ error: 'Failed to parse form data' });
      }

      const file = files.file;

      // Validate the uploaded file
      if (!file || !file.name || !file.path || !file.type) {
        return res.status(400).json({ error: 'Invalid file data' });
      }

      // Upload the file to S3
      const s3Response = await s3Upload(process.env.S3_BUCKET, file);
      console.log("File uploaded to S3:", s3Response.Location);

      // Initialize Pinecone
      await initialize();

      // Generate a unique index name
      const filenameWithoutExt = file.name.split('.')[0];
      const filenameSlug = slugify(filenameWithoutExt, { lower: true, strict: true });

      // Create a Pinecone index
      await createIndex(filenameSlug);

      // Save file info to MongoDB
      const myFile = new MyFileModel({
        fileName: file.name,
        fileUrl: s3Response.Location,
        vectorIndex: filenameSlug,
      });

      await myFile.save();

      // Return success response
      return res.status(200).json({
        message: 'File uploaded successfully and index created',
        fileUrl: s3Response.Location,
        indexName: filenameSlug,
      });
    });
  } catch (error) {
    console.error("Error processing upload:", error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}