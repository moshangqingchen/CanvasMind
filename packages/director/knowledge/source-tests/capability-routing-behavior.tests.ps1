$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$routingPath = Join-Path $repoRoot "docs/superpowers/capability-routing.json"
if (-not (Test-Path -LiteralPath $routingPath)) {
    throw "Missing capability routing metadata: $routingPath"
}

$routing = Get-Content -LiteralPath $routingPath -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedPrecedence = @(
    "verified-rights-and-safety",
    "current-user-intent",
    "verified-product-delivery-facts",
    "core-contract",
    "capability-routing",
    "task-reference",
    "legacy-reference"
)
if (($routing.precedence -join " > ") -ne ($expectedPrecedence -join " > ")) {
    throw "Capability routing precedence has drifted from the core contract."
}

foreach ($marker in @(
    "aspect.default=16:9",
    "aspect.vertical.requires-explicit-intent=required",
    "weather.precipitation.requires-motivation=required",
    "cinematic-look.does-not-imply-rain-neon-wet-ground=required",
    "face-change.does-not-equal-rights-clearance=required",
    "reference.creative-source.origin-verified=required",
    "reference.creative-source.ai-generated=forbidden",
    "reference.generation-benchmark.separate=required",
    "reference.search.task-conditioned=required",
    "reference.search.user-specified-ip-keywords=required",
    "reference.search.excellent-anime-pool=allowed",
    "reference.search.named-ip.nonexclusive-default=required",
    "reference.search.exclusive-scope.requires-explicit-intent=required",
    "dialogue.critical-scene.dual-source-reference=required",
    "dialogue.critical-scene.classification-derived=required",
    "dialogue.new-writing.relevant-ab-reference=required",
    "dialogue.every-line.has-scene-function=required",
    "dialogue.character-knowledge-action-grounding=required",
    "dialogue.speaker-swap-test=required",
    "dialogue.shared-knowledge-exposition=forbidden",
    "dialogue.generic-ai-cliche=forbidden",
    "dialogue.content-before-lip-sync-compression=required",
    "dialogue.output.reference-note=short-after-dialogue",
    "motion.speed-profile.when-story-critical=required",
    "motion.speed.target-and-phase=required",
    "playback.speed.default=real-time",
    "playback.speed-change.requires-explicit-intent=required",
    "speed.adjective-alone=insufficient",
    "fight.reference.dual-visual-track=required",
    "fight.effective-beat-density=5s",
    "fight.single-shot-static-clash=forbidden",
    "fight.multi-shot.default=required",
    "fight.dynamic-long-take.requires-internal-beats=required",
    "power-clash.must-evolve=required"
)) {
    if ($marker -notin @($routing.stableMarkers)) {
        throw "Capability routing is missing stable marker: $marker"
    }
}

foreach ($mode in @("internal-study", "licensed-recreation", "publishable-translation")) {
    if ($mode -notin @($routing.referenceUseModes)) {
        throw "Capability routing is missing reference use mode: $mode"
    }
}

function Assert-TriggerRoutesTo {
    param(
        [Parameter(Mandatory = $true)][string]$Trigger,
        [Parameter(Mandatory = $true)][string]$ExpectedCapability
    )

    $matches = @(
        $routing.overrides.PSObject.Properties |
            Where-Object { $Trigger -in @($_.Value.triggers) } |
            ForEach-Object { $_.Name }
    )
    if ($ExpectedCapability -notin $matches) {
        throw "Trigger '$Trigger' did not route to '$ExpectedCapability'. Matches: $($matches -join ', ')"
    }
}

$visualRecreation = "2026-07-03-ai-super-director-fanwork-style-anchor-library"
foreach ($trigger in @("shot-recreation", "anime-recreation", "film-recreation", "tv-recreation", "viral-video-recreation", "signature-move", "skill", "iconic-scene")) {
    Assert-TriggerRoutesTo -Trigger $trigger -ExpectedCapability $visualRecreation
}

$soundRecreation = "2026-07-03-ai-super-director-fanwork-style-voice-continuation-engine"
foreach ($trigger in @("sound-recreation", "original-audio", "signature-sound", "move-sound", "skill-sound", "iconic-scene-audio")) {
    Assert-TriggerRoutesTo -Trigger $trigger -ExpectedCapability $soundRecreation
}

Assert-TriggerRoutesTo -Trigger "short-drama" -ExpectedCapability "2026-06-07-ai-super-director-short-drama-conflict-reversal-hook-engine"
Assert-TriggerRoutesTo -Trigger "performance" -ExpectedCapability "2026-06-07-ai-super-director-live-performance-emotion-action-directing-library"
Assert-TriggerRoutesTo -Trigger "continuity" -ExpectedCapability "2026-06-07-ai-super-director-continuity-script-supervisor-prop-character-engine"

$videoCapabilityName = "2026-07-12-ai-super-director-seedance-latest-natural-realism-baseline"
foreach ($trigger in @("motion-speed", "playback-speed", "fast-motion")) {
    Assert-TriggerRoutesTo -Trigger $trigger -ExpectedCapability $videoCapabilityName
}
$videoCapability = $routing.overrides.PSObject.Properties[$videoCapabilityName].Value
foreach ($conflict in @("bare-speed-adjective", "implicit-playback-speed-change", "slow-motion-duration-padding", "speed-teleport-substitution")) {
    if ($conflict -notin @($videoCapability.conflicts)) {
        throw "Video capability is missing speed conflict marker: $conflict"
    }
}

$actionCapabilityName = "2026-06-07-ai-super-director-action-fight-vfx-choreography-engine"
foreach ($trigger in @(
    "fight",
    "fight-sequence",
    "fight-isolated-beat",
    "duel",
    "power-clash",
    "beam-clash",
    "dynamic-fight-long-take",
    "speed-critical-action",
    "rapid-action",
    "slow-motion",
    "speed-ramp"
)) {
    Assert-TriggerRoutesTo -Trigger $trigger -ExpectedCapability $actionCapabilityName
}
$actionCapability = $routing.overrides.PSObject.Properties[$actionCapabilityName].Value
foreach ($requirement in @(
    "action-and-fight-direction-reference",
    "fight-scope-classification",
    "spatial-baseline",
    "action-causality",
    "fight-dual-visual-reference-track",
    "creative-reference-origin-verification",
    "task-conditioned-reference-search",
    "multi-beat-fight-timeline",
    "camera-progression",
    "motion-speed-profile"
)) {
    if ($requirement -notin @($actionCapability.requires)) {
        throw "Action capability is missing fight-direction requirement: $requirement"
    }
}
foreach ($conflict in @(
    "single-shot-static-clash",
    "unevolved-power-clash",
    "decorative-camera-orbit",
    "repeated-light-burst-as-progression",
    "b-level-visual-action-inference",
    "ai-generated-creative-reference",
    "unknown-origin-creative-reference",
    "user-specified-ip-keyword-erasure",
    "bare-speed-adjective",
    "implicit-playback-speed-change",
    "slow-motion-duration-padding",
    "speed-teleport-substitution"
)) {
    if ($conflict -notin @($actionCapability.conflicts)) {
        throw "Action capability is missing fight conflict marker: $conflict"
    }
}
foreach ($evidence in @(
    "fight-reference-set",
    "observed-range-creation-mode",
    "origin-evidence",
    "combat-beat-ledger",
    "camera-progression-plan",
    "blocking-or-previs",
    "speed-profile"
)) {
    if ($evidence -notin @($actionCapability.evidenceRequired)) {
        throw "Action capability is missing fight evidence requirement: $evidence"
    }
}

$cameraCapabilityName = "2026-06-07-ai-super-director-camera-language-dictionary"
foreach ($trigger in @("speed-critical-camera", "camera-speed", "camera-acceleration", "camera-deceleration")) {
    Assert-TriggerRoutesTo -Trigger $trigger -ExpectedCapability $cameraCapabilityName
}
$cameraCapability = $routing.overrides.PSObject.Properties[$cameraCapabilityName].Value
if ("motion-speed-profile" -notin @($cameraCapability.requires)) {
    throw "Camera capability is missing motion-speed-profile requirement."
}
if ("camera-speed-curve" -notin @($cameraCapability.evidenceRequired)) {
    throw "Camera capability is missing camera-speed-curve evidence."
}

$dialogueCapabilityName = "2026-08-02-ai-super-director-viral-fanwork-ip-emotional-dialogue-editor"
foreach ($trigger in @("story", "plot", "screenplay", "script", "script-rewrite", "scene-writing", "story-with-dialogue", "dialogue", "dialogue-rewrite", "natural-dialogue", "anti-ai-dialogue", "voiceover", "narration", "ad-dialogue", "brand-line", "character-confirmation", "viral-dialogue", "fanwork-dialogue", "emotional-line")) {
    Assert-TriggerRoutesTo -Trigger $trigger -ExpectedCapability $dialogueCapabilityName
}

$dialogueCapability = $routing.overrides.PSObject.Properties[$dialogueCapabilityName].Value
foreach ($requirement in @(
    "dialogue-and-scene-writing-reference",
    "derived-scene-classification",
    "critical-scene-reference-set",
    "creative-reference-origin-verification",
    "task-conditioned-reference-search",
    "character-objective",
    "relationship-state-before-after",
    "newly-revealed-facts",
    "knowledge-boundary",
    "physical-action",
    "current-platform-evidence",
    "rights-and-provenance-reference"
)) {
    if ($requirement -notin @($dialogueCapability.requires)) {
        throw "Dialogue capability is missing required scene-grounding input: $requirement"
    }
}
foreach ($conflict in @("metadata-only-dialogue-inference", "ai-generated-creative-reference", "unknown-origin-creative-reference", "user-specified-ip-keyword-erasure", "generic-ai-cliche", "shared-knowledge-exposition", "speaker-swappable-dialogue", "dialogue-before-scene-causality")) {
    if ($conflict -notin @($dialogueCapability.conflicts)) {
        throw "Dialogue capability is missing conflict marker: $conflict"
    }
}
foreach ($evidence in @("long-form-dialogue-reference", "current-short-form-dialogue-reference", "observed-range-creation-mode", "origin-evidence", "dialogue-scene-contract", "scene-function-types", "relationship-state-before-after", "newly-revealed-facts", "source-url", "published-at", "captured-at", "current-relevance-evidence", "transcript-provenance", "reference-use-mode", "authorization-status")) {
    if ($evidence -notin @($dialogueCapability.evidenceRequired)) {
        throw "Dialogue capability is missing required evidence: $evidence"
    }
}

$allConflicts = @(
    $routing.overrides.PSObject.Properties |
        ForEach-Object { @($_.Value.conflicts) }
)
foreach ($conflict in @("face-only-clearance", "unlicensed-high-fidelity-recreation", "unlicensed-original-audio")) {
    if ($conflict -notin $allConflicts) {
        throw "Capability routing is missing recreation conflict marker: $conflict"
    }
}

Write-Host "Capability routing behavior checks passed."
