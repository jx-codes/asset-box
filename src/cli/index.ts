#!/usr/bin/env bun

import { parseArgumentTokens, usage, type CliArguments } from "./arguments"
import { pullWorkRequest, pushWorkRequestResult, uploadAssetFile } from "./commands"

async function run(args: CliArguments) {
  if (args.command === "upload") {
    const result = await uploadAssetFile(args)
    if (result instanceof Error) return result
    console.log(
      `${result.status === "created" ? "Uploaded" : "Already exists"}: ${result.asset.title}`,
    )
    console.log(`${args.url.replace(/\/$/, "")}/view/${result.asset.id}`)
    return { tag: "completed" as const }
  }

  if (args.command === "pull") {
    const result = await pullWorkRequest(args)
    if (result instanceof Error) return result
    console.log(`Pulled request ${result.manifest.claim.requestId}`)
    console.log(`Claim expires: ${result.manifest.claim.lifecycle.expiresAt}`)
    console.log(`Workspace: ${result.directory}`)
    return { tag: "completed" as const }
  }

  const result = await pushWorkRequestResult(args)
  if (result instanceof Error) return result
  console.log(
    `${result.lifecycle.tag === "created" ? "Created" : "Replayed"}: ${result.asset.title}`,
  )
  console.log(`${args.url.replace(/\/$/, "")}/view/${result.asset.id}`)
  return { tag: "completed" as const }
}

const args = parseArgumentTokens(process.argv.slice(2))
if (args instanceof Error) {
  console.error(args.message)
  console.error(usage())
  process.exit(1)
}

const result = await run(args)
if (result instanceof Error) {
  console.error(result.message)
  process.exit(1)
}
