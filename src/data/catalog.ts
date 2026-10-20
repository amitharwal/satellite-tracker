import { MANIFEST_FILE, SCHEMA_VERSION, type CatalogFile, type Manifest } from './schema.ts';

export class CatalogError extends Error {
  override name = 'CatalogError';
}

/**
 * Loads the manifest (always revalidated) and then the content-hashed catalog
 * it points to (cacheable). `dataUrl` is the directory URL, ending in '/'.
 */
export async function loadCatalog(
  dataUrl: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<CatalogFile> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const init: RequestInit = options.signal ? { signal: options.signal } : {};

  const manifestResponse = await fetchImpl(`${dataUrl}${MANIFEST_FILE}`, {
    ...init,
    cache: 'no-cache',
  });
  if (!manifestResponse.ok) {
    throw new CatalogError(`Manifest request failed: HTTP ${manifestResponse.status}`);
  }
  const manifest = (await manifestResponse.json()) as Manifest;
  // The file is untrusted input: check the version before relying on the type.
  const version: unknown = (manifest as { schemaVersion: unknown }).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    throw new CatalogError(
      `Unsupported catalog schema ${String(version)} (expected ${SCHEMA_VERSION})`,
    );
  }

  const catalogResponse = await fetchImpl(`${dataUrl}${manifest.file}`, init);
  if (!catalogResponse.ok) {
    throw new CatalogError(`Catalog request failed: HTTP ${catalogResponse.status}`);
  }
  const catalog = (await catalogResponse.json()) as CatalogFile;
  const catalogVersion: unknown = (catalog as { schemaVersion: unknown }).schemaVersion;
  if (catalogVersion !== SCHEMA_VERSION || catalog.count !== manifest.count) {
    throw new CatalogError('Catalog does not match its manifest');
  }
  for (const [name, column] of Object.entries(catalog.columns) as [string, unknown[]][]) {
    if (column.length !== catalog.count) {
      throw new CatalogError(
        `Column ${name} has ${column.length} entries, expected ${catalog.count}`,
      );
    }
  }
  return catalog;
}
