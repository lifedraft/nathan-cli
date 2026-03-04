/**
 * n8n-compatible type definitions for the nathan CLI project.
 *
 * These interfaces mirror the shapes used by the n8n-workflow package so that
 * we can load, inspect, and execute n8n community nodes without pulling in
 * the full n8n-workflow dependency tree (18+ runtime deps).
 *
 * The types are intentionally thorough: every field that a real n8n node
 * descriptor can carry is represented here so that the adapter layer can
 * convert nodes without information loss.
 */

// ---------------------------------------------------------------------------
// Primitives & enums
// ---------------------------------------------------------------------------

/** HTTP methods used in declarative-style routing. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** The wire types that an INodeProperties entry can declare. */
export type NodePropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'options'
  | 'multiOptions'
  | 'collection'
  | 'fixedCollection'
  | 'json'
  | 'color'
  | 'dateTime'
  | 'resourceLocator'
  | 'resourceMapper'
  | 'notice'
  | 'hidden';

/** Resource-locator modes. */
export type ResourceLocatorMode = 'list' | 'id' | 'url' | 'name';

/** Credential authentication method shapes. */
export type AuthenticationType = 'generic' | 'custom' | 'none';

// ---------------------------------------------------------------------------
// Display options — controls visibility of a property
// ---------------------------------------------------------------------------

/** A single display-options condition.  Keys are property names, values are arrays of allowed values. */
export type DisplayCondition = Record<string, Array<string | number | boolean>>;

export interface IDisplayOptions {
  show?: DisplayCondition;
  hide?: DisplayCondition;
}

// ---------------------------------------------------------------------------
// Node property options (dropdown items, collection fields, etc.)
// ---------------------------------------------------------------------------

/** Routing information attached to an option value (declarative nodes). */
export interface INodePropertyRouting {
  request?: {
    method?: HttpMethod;
    url?: string;
    baseURL?: string;
    body?: Record<string, unknown> | string;
    qs?: Record<string, unknown>;
    headers?: Record<string, string>;
    encoding?: string;
    ignoreHttpStatusErrors?: boolean;
    skipPreSend?: boolean;
    returnFullResponse?: boolean;
  };
  send?: {
    preSend?: string[];
    paginate?: boolean | string;
    type?: 'body' | 'query';
    property?: string;
    propertyInDotNotation?: boolean;
    value?: string;
  };
  output?: {
    postReceive?: Array<
      | string
      | {
          type: 'rootProperty' | 'set' | 'setKeyValue' | 'filter' | 'limit' | 'sort' | 'binaryData';
          properties?: Record<string, unknown>;
          enabled?: boolean;
        }
    >;
    maxResults?: number | string;
  };
}

/** A single option inside a property of type "options" or "multiOptions". */
export interface INodePropertyOptions {
  name: string;
  value: string | number | boolean;
  action?: string;
  description?: string;
  routing?: INodePropertyRouting;
}

/** Entry inside a fixedCollection — a named group of sub-properties. */
export interface INodePropertyCollectionEntry {
  name: string;
  displayName: string;
  values: INodeProperties[];
}

// ---------------------------------------------------------------------------
// Type-specific options
// ---------------------------------------------------------------------------

export interface INodePropertyTypeOptions {
  /** Min/max for number fields. */
  minValue?: number;
  maxValue?: number;
  numberPrecision?: number;
  numberStepSize?: number;

  /** Rows for multiline string fields. */
  rows?: number;
  /** Whether the field supports expression evaluation. */
  expirable?: boolean;
  /** Whether a password-style mask should be applied. */
  password?: boolean;

  /** Allowed MIME types for binary inputs. */
  acceptedMimeTypes?: string[];

  /** Fixed-collection flag: allow multiple groups. */
  multipleValues?: boolean;
  multipleValueButtonText?: string;
  sortable?: boolean;

  /** Loadable option list (lazy). */
  loadOptionsMethod?: string;
  loadOptionsDependsOn?: string[];

  /** Resource locator modes. */
  mode?: ResourceLocatorMode;
  modes?: Array<{
    displayName: string;
    name: ResourceLocatorMode;
    type: string;
    hint?: string;
    validation?: Array<{ type: string; properties?: Record<string, unknown> }>;
    placeholder?: string;
    url?: string;
  }>;

  /** Resource mapper options. */
  resourceMapper?: {
    resourceMapperMethod?: string;
    mode?: string;
    addAllFields?: boolean;
    noFieldsError?: string;
    multiKeyMatch?: boolean;
    fieldWords?: { singular: string; plural: string };
    supportAutoMap?: boolean;
    matchingFieldsLabels?: { title?: string; description?: string; hint?: string };
  };

  /** Allow editor for code/json fields. */
  editor?: string;
  editorLanguage?: string;

  /** For boolean fields: label pair. */
  trueLabel?: string;
  falseLabel?: string;

  /** Whether to include a "none" option automatically. */
  includeNone?: boolean;

  /** Any arbitrary extra keys n8n nodes sometimes add. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// INodeProperties — a single parameter descriptor
// ---------------------------------------------------------------------------

export interface INodeProperties {
  displayName: string;
  name: string;
  type: NodePropertyType;
  default: unknown;
  description?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  noDataExpression?: boolean;
  displayOptions?: IDisplayOptions;
  options?: Array<INodePropertyOptions | INodeProperties | INodePropertyCollectionEntry>;
  typeOptions?: INodePropertyTypeOptions;
  routing?: INodePropertyRouting;

  /** Whether the property should be extracted from the "Additional Fields" collection. */
  extractValue?: {
    type: string;
    regex?: string;
  };

  /** Credential-related. */
  credentialTypes?: string[];

  /** Validation rules. */
  validateType?: string;

  /** Default value when the expression evaluator is used. */
  requiresDataPath?: 'single' | 'multiple';

  /** Category label shown in the UI (n8n >= 1.x). */
  category?: string[];
}

// ---------------------------------------------------------------------------
// Codex (AI / tool-use metadata)
// ---------------------------------------------------------------------------

export interface INodeTypeCodex {
  categories?: string[];
  subcategories?: Record<string, string[]>;
  resources?: {
    primaryDocumentation?: Array<{ url: string }>;
    credentialDocumentation?: Array<{ url: string }>;
  };
  alias?: string[];
}

// ---------------------------------------------------------------------------
// Request defaults (declarative nodes)
// ---------------------------------------------------------------------------

export interface INodeRequestDefaults {
  baseURL?: string;
  url?: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  qs?: Record<string, string>;
  body?: Record<string, unknown> | string;
  encoding?: string;
  json?: boolean;
  timeout?: number;
  ignoreHttpStatusErrors?: boolean;
  skipPreSend?: boolean;
  returnFullResponse?: boolean;
}

// ---------------------------------------------------------------------------
// Input / output connection descriptions
// ---------------------------------------------------------------------------

export type ConnectionType =
  | 'main'
  | 'ai_agent'
  | 'ai_chain'
  | 'ai_document'
  | 'ai_embedding'
  | 'ai_languageModel'
  | 'ai_memory'
  | 'ai_outputParser'
  | 'ai_retriever'
  | 'ai_textSplitter'
  | 'ai_tool'
  | 'ai_vectorStore';

export type NodeConnectionDescription =
  | string
  | {
      type: ConnectionType;
      displayName?: string;
      required?: boolean;
      maxConnections?: number;
    };

// ---------------------------------------------------------------------------
// INodeTypeDescription — the full node descriptor
// ---------------------------------------------------------------------------

export interface INodeTypeDescription {
  displayName: string;
  name: string;
  icon?: string;
  iconUrl?: string;
  group: string[];
  version: number | number[];
  defaultVersion?: number;
  description: string;
  subtitle?: string;
  defaults: {
    name: string;
    color?: string;
    [key: string]: unknown;
  };
  inputs: NodeConnectionDescription[] | string;
  outputs: NodeConnectionDescription[] | string;
  credentials?: Array<{
    name: string;
    required?: boolean;
    displayOptions?: IDisplayOptions;
    testedBy?: string;
  }>;
  properties: INodeProperties[];
  requestDefaults?: INodeRequestDefaults;

  /** Whether this node can be used as an AI tool. */
  usableAsTool?: boolean;

  /** Codex / AI metadata. */
  codex?: INodeTypeCodex;

  /** Maximum number of items the node can output in a single execution. */
  maxNodes?: number;

  /** Whether the node supports polling. */
  polling?: boolean;

  /** Trigger node flag. */
  trigger?: {
    /** Whether the trigger should poll. */
    polling?: boolean;
  };

  /** Webhook definitions for webhook-trigger nodes. */
  webhooks?: Array<{
    name: string;
    httpMethod: HttpMethod | string;
    path: string;
    responseMode?: string;
    isFullPath?: boolean;
  }>;

  /** Event-trigger-specific metadata. */
  eventTriggerDescription?: string;
  activationMessage?: string;

  /** Documentation URL. */
  documentationUrl?: string;

  /** Badge label (e.g. "BETA"). */
  badge?: string;

  /** Sorting hint for the node palette. */
  displayOrder?: number;

  /** Whether the node is hidden from the palette. */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// INodeType — the runtime class shape
// ---------------------------------------------------------------------------

export interface INodeType {
  description: INodeTypeDescription;
  methods?: {
    loadOptions?: Record<string, () => Promise<INodePropertyOptions[]>>;
    credentialTest?: Record<
      string,
      (credential: unknown) => Promise<{ status: string; message: string }>
    >;
    listSearch?: Record<
      string,
      (
        filter?: string,
        paginationToken?: string,
      ) => Promise<{ results: Array<{ name: string; value: string }>; paginationToken?: string }>
    >;
    resourceMapping?: Record<
      string,
      () => Promise<{
        fields: Array<{
          id: string;
          displayName: string;
          type: string;
          required: boolean;
          defaultMatch: boolean;
        }>;
      }>
    >;
  };
  execute?: (this: IExecuteFunctions) => Promise<INodeExecutionData[][]>;
  poll?: (this: IExecuteFunctions) => Promise<INodeExecutionData[][] | null>;
  trigger?: (
    this: IExecuteFunctions,
  ) => Promise<
    { closeFunction?: () => Promise<void>; manualTriggerFunction?: () => Promise<void> } | undefined
  >;
  webhook?: (
    this: IExecuteFunctions,
  ) => Promise<{ webhookResponse?: unknown; workflowData?: INodeExecutionData[][] }>;
}

// ---------------------------------------------------------------------------
// Execution data
// ---------------------------------------------------------------------------

export interface IBinaryData {
  data: string;
  mimeType: string;
  fileName?: string;
  fileSize?: number;
  fileExtension?: string;
  directory?: string;
  id?: string;
}

export interface INodeExecutionData {
  json: Record<string, unknown>;
  binary?: Record<string, IBinaryData>;
  pairedItem?: { item: number; input?: number } | Array<{ item: number; input?: number }> | number;
  error?: Error;
}

export interface IDataObject {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Workflow / node context (used during execution)
// ---------------------------------------------------------------------------

export interface IWorkflowMetadata {
  id?: string;
  name?: string;
  active?: boolean;
}

export interface INodeMetadata {
  name: string;
  type: string;
  typeVersion: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// IExecuteFunctions — the helpers object passed to execute()
// ---------------------------------------------------------------------------

export interface IHttpRequestOptions {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  qs?: Record<string, string | number | boolean | string[]>;
  encoding?: string;
  json?: boolean;
  timeout?: number;
  returnFullResponse?: boolean;
  ignoreHttpStatusErrors?: boolean;
  proxy?: string;
  followRedirect?: boolean;
  maxRedirects?: number;
  arrayFormat?: 'indices' | 'brackets' | 'repeat' | 'comma';
}

export interface IRequestOptions {
  uri?: string;
  url?: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  qs?: Record<string, unknown>;
  json?: boolean;
  encoding?: string | null;
  timeout?: number;
  rejectUnauthorized?: boolean;
  followRedirect?: boolean;
  followAllRedirects?: boolean;
  maxRedirects?: number;
  resolveWithFullResponse?: boolean;
  simple?: boolean;
  proxy?: string;
  form?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  auth?: { user: string; pass: string; sendImmediately?: boolean };
  agentOptions?: Record<string, unknown>;
}

export interface IExecuteFunctions {
  getNodeParameter(parameterName: string, itemIndex: number, fallbackValue?: unknown): unknown;
  getCredentials(type: string, itemIndex?: number): Promise<Record<string, unknown>>;
  getInputData(inputIndex?: number, inputName?: string): INodeExecutionData[];
  getWorkflow(): IWorkflowMetadata;
  getNode(): INodeMetadata;
  getMode(): 'manual' | 'trigger' | 'webhook' | 'internal';
  getTimezone(): string;
  getRestApiUrl(): string;
  getInstanceBaseUrl(): string;
  continueOnFail(error?: Error): boolean;
  evaluateExpression(expression: string, itemIndex: number): unknown;

  helpers: {
    request(options: IRequestOptions): Promise<unknown>;
    requestWithAuthentication(
      credentialType: string,
      options: IRequestOptions,
      additionalCredentialOptions?: Record<string, unknown>,
    ): Promise<unknown>;
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
    httpRequestWithAuthentication(
      credentialType: string,
      options: IHttpRequestOptions,
      additionalCredentialOptions?: Record<string, unknown>,
    ): Promise<unknown>;
    prepareBinaryData(
      binaryData: Buffer | Uint8Array,
      fileName?: string,
      mimeType?: string,
    ): Promise<IBinaryData>;
    getBinaryDataBuffer(itemIndex: number, propertyName: string): Promise<Buffer>;
    returnJsonArray(jsonData: unknown): INodeExecutionData[];
    constructExecutionMetaData(
      inputData: INodeExecutionData[],
      options: { itemData: { item: number; input?: number } },
    ): INodeExecutionData[];
    assertBinaryData(itemIndex: number, propertyName: string): IBinaryData;
    binaryToBuffer(body: IBinaryData): Promise<Buffer>;
  };

  /** Logger available inside node execution. */
  logger: {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

// ---------------------------------------------------------------------------
// Credential types
// ---------------------------------------------------------------------------

export interface IAuthenticateGeneric {
  type: 'generic';
  properties: {
    headers?: Record<string, string>;
    qs?: Record<string, string>;
    body?: Record<string, string>;
    auth?: {
      username: string;
      password: string;
    };
  };
}

export interface ICredentialTestRequest {
  request: {
    method?: HttpMethod;
    url?: string;
    baseURL?: string;
    headers?: Record<string, string>;
    qs?: Record<string, string>;
    body?: unknown;
  };
  rules?: Array<{
    type: 'responseCode' | 'responseSuccessBody';
    properties: Record<string, unknown>;
  }>;
}

export interface ICredentialDataDecryptedObject {
  [key: string]: unknown;
}

export interface ICredentialType {
  name: string;
  displayName: string;
  documentationUrl?: string;
  icon?: string;
  iconUrl?: string;
  extends?: string[];
  properties: INodeProperties[];
  authenticate?:
    | IAuthenticateGeneric
    | {
        type: 'custom';
        properties: Record<string, unknown>;
      };
  test?: ICredentialTestRequest;
  /** Pre-authentication hook (e.g. for OAuth token refresh). */
  preAuthentication?: (
    credentials: ICredentialDataDecryptedObject,
  ) => Promise<ICredentialDataDecryptedObject>;

  /** Generic auth info used by n8n to inject creds into requests. */
  genericAuth?: boolean;

  /** HTTP request configuration for testing the credentials. */
  httpRequestNode?: {
    name: string;
    docsUrl: string;
    apiBaseUrl: string;
  };
}
