const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");
const { connectDB } = require("./src/db/MongoDB");
const { createUser, getUsers } = require("./src/controller/UserController");

dotenv.config();
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views")); // Set the views directory

app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "adfkdskfskdfksdfksdf",
    resave: true,
    saveUninitialized: true,
  })
);

async function checkToken(req) {
  if (req.session.access_token && Date.now() < req.session.expires_at) {
    console.log("re-using access token...", req.session);
  } else {
    console.log("generating new access token");
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    const results = await dsApiClient.requestJWTUserToken(
      process.env.INTEGRATION_KEY,
      process.env.USER_ID,
      "signature",
      fs.readFileSync(path.join(__dirname, "private.key")),
      3600
    );

    console.log(results.body);

    req.session.access_token = results.body.access_token;
    req.session.expires_at = Date.now() + results.body.expires_in * 1000;
  }
}

async function makeTemplate(name, email) {
  let docPdfBytes;

  try {
    docPdfBytes = fs.readFileSync(path.join(__dirname, "dummy-contract.pdf"));
    let doc = new docusign.Document();
    let doc64 = Buffer.from(docPdfBytes).toString("base64");
    doc.documentBase64 = doc64;
    doc.name = "Employee Contract";
    doc.fileExtension = "pdf";
    doc.documentId = "1";

    // let signer = docusign.Signer.constructFromObject({
    //   email: email,
    //   name: name,
    //   clientUserId: process.env.CLIENT_USER_ID,
    //   roleName: "Applicant",
    // });
    let signer = docusign.Signer.constructFromObject({
      roleName: "signer",
      recipientId: "1",
      routingOrder: "1",
    });

    let cc1 = new docusign.CarbonCopy();
    cc1.roleName = "cc";
    cc1.routingOrder = "2";
    cc1.recipientId = "2";

    let signHere = docusign.SignHere.constructFromObject({
      documentId: "1",
      pageNumber: "2",
      xPosition: "120",
      yPosition: "470",
    });

    let text = docusign.Text.constructFromObject({
      documentId: "1",
      pageNumber: "1",
      xPosition: "80",
      yPosition: "120",
      font: "helvetica",
      fontSize: "size14",
      tabLabel: "text",
      height: "20",
      width: "75",
      required: "true",
    });

    let signer1Tab = docusign.Tabs.constructFromObject({
      textTabs: [text],
      signHereTabs: [signHere],
    });

    signer.tabs = signer1Tab;

    let recipients = docusign.Recipients.constructFromObject({
      signers: [signer],
      CarbonCopies: [cc1],
    });

    let template = new docusign.EnvelopeTemplate.constructFromObject({
      documents: [doc],
      emailSubject: "Please sign this document",
      description: "Example template created via the API",
      name: "Employee Contract",
      shared: "false",
      recipients: recipients,
      templateRoles: [signer],
      status: "created",
    });

    return template;
  } catch (err) {
    console.log("error...", err);
  }
}

async function getEnvelopesApi(req) {
  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + req.session.access_token
  );
  const envelopesAPI = new docusign.EnvelopesApi(dsApiClient);
  return envelopesAPI;
}

function makeEnvelope(name, email, templateId) {
  console.log("template id...", templateId);
  let env = new docusign.EnvelopeDefinition();
  if (templateId) {
    env.templateId = templateId;
  } else {
    env.templateId = process.env.TEMPLATE_ID;
  }

  let signer1 = docusign.TemplateRole.constructFromObject({
    email: email,
    name: name,
    clientUserId: process.env.CLIENT_USER_ID,
    roleName: "signer",
  });

  // Add the TemplateRole objects to the envelope object
  env.templateRoles = [signer1];

  env.status = "sent"; // We want the envelope to be sent
  return env;
}

function makeRecipientViewRequest(name, email) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = `http://localhost:5000/success?email=${email}&templateId=${process.env.TEMPLATE_ID}`;

  viewRequest.authenticationMethod = "none";

  // Recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = process.env.CLIENT_USER_ID;

  return viewRequest;
}
app.get("/", async (req, res) => {
  await checkToken(req);
  res.sendFile(path.join(__dirname, "template/main.html"));
});

app.post("/form", async (req, res) => {
  await checkToken(req);

  let envelopesApi = await getEnvelopesApi(req);

  const template = await makeTemplate(req.body.name, req.body.email);
  console.log("template...", template);

  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + req.session.access_token
  );
  let templatesApi = new docusign.TemplatesApi(dsApiClient);
  const templateData = await templatesApi.createTemplate(
    process.env.ACCOUNT_ID,
    {
      envelopeTemplate: template,
    }
  );
  console.log("results...", templateData);

  // Make the envelope request body
  let envelope = makeEnvelope(
    req.body.name,
    req.body.email,
    templateData.templateId
  );
  // console.log("envelopes api...", envelopesApi);
  // Call Envelopes::create API method
  // Exceptions will be caught by the calling function createEnvelope
  let results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, {
    envelopeDefinition: envelope,
  });

  let viewRequest = makeRecipientViewRequest(req.body.name, req.body.email);
  // Call the CreateRecipientView API
  // Exceptions will be caught by the calling function
  results = await envelopesApi.createRecipientView(
    process.env.ACCOUNT_ID,
    results?.envelopeId,
    {
      recipientViewRequest: viewRequest,
    }
  );
  console.log("results...", results);
  res.redirect(results?.url);
  // res.send("template created");
});

app.post("/custom-template", async (req, res) => {
  await checkToken(req);

  let envelopesApi = await getEnvelopesApi(req);

  // Make the envelope request body
  let envelope = makeEnvelope(req.body.name, req.body.email);

  // Call Envelopes::create API method
  // Exceptions will be caught by the calling function createEnvelope
  let results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, {
    envelopeDefinition: envelope,
  });
  let envelopeId = results?.envelopeId;

  console.log("create envelope result...", results);
  let viewRequest = makeRecipientViewRequest(req.body.name, req.body.email);

  // Call the CreateRecipientView API
  // Exceptions will be caught by the calling function
  results = await envelopesApi.createRecipientView(
    process.env.ACCOUNT_ID,
    envelopeId,
    {
      recipientViewRequest: viewRequest,
    }
  );

  const userData = await createUser(
    req.body.name,
    req.body.email,
    req.body.company,
    envelopeId
  );
  console.log("results...", userData);
  res.redirect(results?.url);
  // res.send("received");
});

app.get("/success", async (req, res) => {
  // res.sendFile(path.join(__dirname, "template/document-complete.html"));
  const { email } = req.params;

  // const users = await getUsers();
  // console.log("user...", users);
  let users = [];
  res.render("index", {
    users,
  });
});

app.get("/download/pdf/:envelopeId", async (req, res) => {
  await checkToken(req);
  const envelopesApi = await getEnvelopesApi(req);
  let envelopeId = req.params.envelopeId;
  let results = await envelopesApi.listDocuments(
    process.env.ACCOUNT_ID,
    envelopeId,
    null
  );
  console.log("results...", results);

  const document = results.envelopeDocuments;

  // Download the document from the envelope
  envelopesApi.getDocument(
    process.env.ACCOUNT_ID,
    envelopeId,
    document[0].documentId,
    (error, response) => {
      if (error) {
        // console.error('Error downloading document:', error);
        res.send("Document could not download" + error);
      } else {
        const documentFileName = "downloaded_document.pdf"; // Change this to the desired file name
        const documentBuffer = Buffer.from(response, "binary");

        fs.writeFile(documentFileName, documentBuffer, (writeError) => {
          if (writeError) {
            console.error("Error writing document to file:", writeError);
            res.send("Error writing document to file:", writeError);
          } else {
            console.log(`Document downloaded and saved as ${documentFileName}`);
            // res.send("Document downloaded");
            res.download(documentFileName, "downloaded_document.pdf");
          }
        });
      }
    }
  );
});

app.get("/download-document", async (req, res) => {
  await checkToken(req);
  const envelopesApi = await getEnvelopesApi(req);
  let envelopeId = "5ddec33c-fb63-4dfd-b5d6-3b5aa8db88c4";
  let results = await envelopesApi.listDocuments(
    process.env.ACCOUNT_ID,
    envelopeId,
    null
  );
  console.log("results...", results);

  const document = results.envelopeDocuments;

  // let documentResults = await envelopesApi.getDocument(
  //   process.env.ACCOUNT_ID,
  //   envelopeId,
  //   document[0].documentId,
  //   {}
  // );
  // // generate a file stream
  // const tempFile = path.resolve(__dirname, "document.pdf");
  // fs.writeFileSync(tempFile, documentResults);
  // // writer.write(documentResults);
  // res.send(documentResults);

  // Download the document from the envelope
  envelopesApi.getDocument(
    process.env.ACCOUNT_ID,
    envelopeId,
    document[0].documentId,
    (error, response) => {
      if (error) {
        // console.error('Error downloading document:', error);
        res.send("Document could not download" + error);
      } else {
        const documentFileName = "downloaded_document.pdf"; // Change this to the desired file name
        const documentBuffer = Buffer.from(response, "binary");

        fs.writeFile(documentFileName, documentBuffer, (writeError) => {
          if (writeError) {
            console.error("Error writing document to file:", writeError);
            res.send("Error writing document to file:", writeError);
          } else {
            console.log(`Document downloaded and saved as ${documentFileName}`);
            // res.send("Document downloaded");
            res.download(documentFileName, "downloaded_document.pdf");
          }
        });
      }
    }
  );
});
app.listen(5000, () => {
  console.log(
    `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${process.env.INTEGRATION_KEY}&redirect_uri=http://localhost:5000/`
  );
  console.log("server running on port 5000", process.env.USER_ID);
  connectDB();
});
