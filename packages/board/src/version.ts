import pkg from '../package.json' with { type: 'json' }

export const VERSION: string = pkg.version
/** The A2 that `backend-a2`, and so `board serve`, runs on: a peer the project installs itself. */
export const A2_VERSION: string = pkg.peerDependencies['experimental-a2']
