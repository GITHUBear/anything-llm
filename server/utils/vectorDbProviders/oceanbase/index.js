const { Sequelize, QueryTypes, Model, DataTypes } = require('sequelize');
const {
    toChunks,
    getLLMProvider,
    getEmbeddingEngineSelection,
} = require("../../helpers");
const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { storeVectorResult, cachedVectorInformation } = require("../../files");
const { v4: uuidv4 } = require("uuid");

class OBVECTOR extends DataTypes.ABSTRACT {
    constructor(dim) {
        super();
        this.dim = dim;
    }
    toSql() {
        return `VECTOR(${dim})`;
    }
    _stringify(value) {
        if (Array.isArray(value) && value.length === this.dim) {
            return `'[${value.join(',')}]'`;
        } else {
            throw new Error(`VECTOR(${this.dim}) received a value of incorrect dimension`);
        }
    }
    _sanitize(value) {
        if (typeof value === 'string') {
            return value.substring(1, value.length - 1).split(',').map(Number);
        } else {
            throw new Error(`value is not a string`);
        }
    }
    _isChanged(value, originalValue) {
        return value.join(',') !== originalValue.join(',');
    }
}
DataTypes.OBVECTOR = OBVECTOR;

const OceanBase = {
    name: "OceanBase",
    connect: async function () {
        if (process.env.VECTOR_DB !== "oceanbase") {
            throw new Error("OceanBase::Invalid ENV settings");
        }
        const connection = new Sequelize(
            process.env.OB_DATABASE,
            process.env.OB_USER,
            process.env.OB_PASSWORD,
            {
                host: process.env.OB_HOST,
                port: process.env.OB_PORT,
                dialect: 'mysql'
            }
        );
        try {
            await connection.authenticate();
        } catch (err) {
            throw new Error(
                "OceanBase::Invalid cannot connect to oceanbase"
            );
        }
        return { connection }
    },
    heartbeat: async function () {
        await this.connect();
        return { heartbeat: Number(new Date()) };
    },
    tables: async function(_client = null) {
        const query_vtbs = 'SHOW TABLES LIKE \'VTB_%\'';
        const connection = _client || (await this.connect())['connection'];
        const vtbs = await connection.query(query_vtbs, { type: QueryTypes.SELECT });
        return vtbs;
    },
    getTableRowCount: async function(table_name, _client = null) {
        const query_vtb_row_count = `SELECT COUNT(*) as count FROM ${table_name}`;
        const connection = _client || (await this.connect())['connection'];
        const countResult = await connection.query(query_vtb_row_count, { type: QueryTypes.SELECT });
        return countResult[0]['count'];
    },
    totalVectors: async function() {
        const { connection } = await this.connect();
        const vtbs = await this.tables(connection);
        let count = 0;
        for (const tableResult of vtbs) {
            count += await this.getTableRowCount(tableResult[Object.keys(tableResult)[0]], connection);
        }
        return count;
    },
    namespaceCount: async function(_namespace = null) {
        const { connection } = await this.connect();
        const exists = await this.namespaceExists(connection, _namespace);
        if (!exists) return 0;

        return (await this.getTableRowCount(_namespace, connection)) || 0;
    },
    namespace: async function (_client, namespace = null) {
        if (!namespace) throw new Error("No namespace value provided.");
        const all_table_query = `SELECT * FROM oceanbase.__all_table WHERE table_name=\'VTB_${namespace}\'`;
        const namespaceResult = await connection.query(all_table_query, { type: QueryTypes.SELECT });
        if (0 == namespaceResult.length) {
            return null;
        }
        return {
            ...namespaceResult[0]
        };
    },
    hasNamespace: async function (_client, namespace = null){
        if (!namespace) return false;
        const { connection } = await this.connect();
        const exists = await this.namespaceExists(connection, namespace);
        return exists;
    },
    namespaceExists: async function (_client, namespace = null) {
        if (!namespace) throw new Error("No namespace value provided.");
        const vtbs = await this.tables(_client);
        const table_names = vtbs.map(vtb => {
            return vtb[Object.keys(vtb)[0]];
        });
        return table_names.includes(namespace);
    },
    deleteVectorsInNamespace: async function (_client, namespace = null) {
        const drop_table_query = `DROP TABLE IF EXISTS VTB_${namespace}`;
        const connection = _client || (await this.connect())['connection'];
        try {
            await connection.query(drop_table_query);
            return true;
        } catch {
            return false;
        }
    },
    updateOrCreateCollection: async function (_client, data = [], namespace) {
        const dim = data.vector.length;
        const table_schema = {
            id: {
                type: DataTypes.STRING(40),
                allowNull: false,
                primaryKey: true
            },
            embedding: {
                type: DataTypes.OBVECTOR(dim),
                allowNull: false,
            },
            metadata: {
                type: DataTypes.JSON,
                allowNull: true
            }
        };
        const connection = _client || (await this.connect())['connection'];
        const vector_table = connection.define(`VTB_${namespace}`, table_schema, {
            timestamps: false,
            tableName: `VTB_${namespace}`,
        });
        // create or open table
        await vector_table.sync();

        // insert data into new_table
        for (const new_row of data) {
            await vector_table.create({
                id: new_row.id,
                embedding: new_row.vector,
                metadata: new_row.metadata
            });
        }
    },
    addDocumentToNamespace: async function (
        namespace,
        documentData = {},
        fullFilePath = null
    ) {
        const { DocumentVectors } = require("../../../models/vectors");
        try {
            const { pageContent, docId, ...metadata } = documentData;
            if (!pageContent || pageContent.length == 0) return false;

            console.log("Adding new vectorized document into namespace", namespace);
            const cacheResult = await cachedVectorInformation(fullFilePath);
            if (cacheResult.exists) {
                const { connection } = await this.connect();
                const { chunks } = cacheResult;
                const documentVectors = [];
                const submissions = [];

                for (const chunk of chunks) {
                    chunk.forEach((chunk) => {
                        const id = uuidv4();
                        documentVectors.push({ docId, vectorId: id });
                        submissions.push({ id: id, vector: chunk.values, metadata: chunk.metadata });
                    });
                }
          
                await this.updateOrCreateCollection(connection, submissions, namespace);
                await DocumentVectors.bulkInsert(documentVectors);
                return { vectorized: true, error: null };
            }

            const textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize:
                    getEmbeddingEngineSelection()?.embeddingMaxChunkLength || 1_000,
                chunkOverlap: 20,
            });
            const textChunks = await textSplitter.splitText(pageContent);

            console.log("Chunks created from document:", textChunks.length);
            const LLMConnector = getLLMProvider();
            const documentVectors = [];
            const vectors = [];
            const vectorValues = await LLMConnector.embedChunks(textChunks);

            if (!!vectorValues && vectorValues.length > 0) {
                for (const [i, vector] of vectorValues.entries()) {
                    const vectorRecord = {
                        id: uuidv4(),
                        values: vector,
                        // [DO NOT REMOVE]
                        // LangChain will be unable to find your text if you embed manually and dont include the `text` key.
                        // https://github.com/hwchase17/langchainjs/blob/2def486af734c0ca87285a48f1a04c057ab74bdf/langchain/src/vectorstores/pinecone.ts#L64
                        metadata: { ...metadata, text: textChunks[i] },
                    };
        
                    vectors.push(vectorRecord);
                    documentVectors.push({ docId, vectorId: vectorRecord.id });
                }
            } else {
                throw new Error(
                    "Could not embed document chunks! This document will not be recorded."
                );
            }

            if (vectors.length > 0) {
                const chunks = [];
                const { connection } = await this.connect();

                console.log("Inserting vectorized chunks into OceanBase.");
                for (const chunk of toChunks(vectors, 500)) chunks.push(chunk);

                await this.updateOrCreateCollection(connection, vectors, namespace);
                await storeVectorResult(chunks, fullFilePath);
            }

            await DocumentVectors.bulkInsert(documentVectors);
            return { vectorized: true, error: null };
        } catch(e) {
            console.error("addDocumentToNamespace", e.message);
            return { vectorized: false, error: e.message };
        }
    },
    deleteDocumentFromNamespace: async function (namespace, docId) {
        // Deleting vector is not implement in OceanBase.
        return true;
    },
    performSimilaritySearch: async function ({
        namespace = null,
        input = "",
        LLMConnector = null,
        similarityThreshold = 0.25,
        topN = 4,
    }) {
        if (!namespace || !input || !LLMConnector)
            throw new Error("Invalid request to performSimilaritySearch.");

        const { connection } = await this.connect();
        if (!(await this.namespaceExists(connection, namespace))) {
            return {
                contextTexts: [],
                sources: [],
                message: "Invalid query - no documents found for workspace!",
            };
        }

        const queryVector = await LLMConnector.embedTextInput(input);
        const { contextTexts, sourceDocuments } = await this.similarityResponse(
            connection,
            namespace,
            queryVector,
            similarityThreshold,
            topN
        );

        const sources = sourceDocuments.map((metadata, i) => {
            return { ...metadata, text: contextTexts[i] };
        });
        return {
            contextTexts,
            sources: this.curateSources(sources),
            message: false,
        };
    },
    distanceToSimilarity: function (distance = null) {
        if (distance === null || typeof distance !== "number") return 0.0;
        if (distance >= 1.0) return 1;
        if (distance <= 0) return 0;
        return 1 - distance;
    },
    similarityResponse: async function (
        _client,
        namespace,
        queryVector,
        similarityThreshold = 0.25,
        topN = 4
    ) {
        const result = {
            contextTexts: [],
            sourceDocuments: [],
            scores: [],
        };
        const ann_query = `SELECT metadata, embedding<->'[${queryVector.join(',')}]' as score FROM VTB_${namespace} ORDER BY embedding<->'[${queryVector.join(',')}]' LIMIT ${topN}`;
        const connection = _client || (await this.connect())['connection'];
        const ann_query_result = await connection.query(ann_query, { type: QueryTypes.SELECT });
        for (const ann_row of ann_query_result) {
            // similarityThreshold is not defined in OceanBase.
            // TODO: Is vector normalized?
            if (this.distanceToSimilarity(ann_row['score']) < similarityThreshold) return result;
            result.contextTexts.push(ann_row['metadata'].text);
            result.sourceDocuments.push(ann_row);
            result.scores.push(this.distanceToSimilarity(ann_row['score']));
        }
        return result;
    },
    "namespace-stats": async function (reqBody = {}) {
        const { namespace = null } = reqBody;
        if (!namespace) throw new Error("namespace required");
        const { connection } = await this.connect();
        if (!(await this.namespaceExists(connection, namespace)))
            throw new Error("Namespace by that name does not exist.");
        const stats = await this.namespace(connection, namespace);
        return stats
            ? stats
            : { message: "No stats were able to be fetched from DB for namespace" };
    },
    "delete-namespace": async function (reqBody = {}) {
        const { namespace = null } = reqBody;
        const { connection } = await this.connect();
        if (!(await this.namespaceExists(connection, namespace)))
            throw new Error("Namespace by that name does not exist.");

        const deleteResult = await this.deleteVectorsInNamespace(connection, namespace);
        if (deleteResult) {
            return {
                message: `Namespace ${namespace} was deleted.`,
            };
        } else {
            return {
                message: `Fail to delete namespace ${namespace}.`,
            };
        }
    },
    curateSources: function (sources = []) {
        const documents = [];
        for (const source of sources) {
            const { metadata = {} } = source;
            if (Object.keys(metadata).length > 0) {
                documents.push({
                    ...metadata,
                    ...(source.hasOwnProperty("pageContent")
                    ? { text: source.pageContent }
                    : {}),
                });
            }
        }
        return documents;
    },
};

module.exports.OceanBase = OceanBase;