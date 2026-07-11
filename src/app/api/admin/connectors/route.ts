import {
  handleExternalConnectorList,
  handleExternalConnectorPersistence
} from "./handler";

export async function GET(request: Request): Promise<Response> {
  return handleExternalConnectorList(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleExternalConnectorPersistence(request);
}
