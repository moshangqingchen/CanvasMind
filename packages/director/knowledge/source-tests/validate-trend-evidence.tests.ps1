$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $repoRoot ".agents/skills/ai-super-director/scripts/validate-trend-evidence.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Missing trend evidence validator: $scriptPath"
}

$trendGatePath = Join-Path $repoRoot ".agents/skills/ai-super-director/references/trend-gate.md"
$trendGateText = Get-Content -LiteralPath $trendGatePath -Raw -Encoding UTF8
foreach ($marker in @(
    ".agents/skills/ai-super-director/scripts/validate-trend-evidence.ps1",
    "verified_mechanism.entry={type,evidence_basis,description}",
    "observed_signals.entry={type,evidence_basis,description}",
    "evidence.description.authority=display-only",
    "evidence.A.audio-claims.require=audio:yes|partial",
    "evidence.A.dialogue-claims.require=audio:yes|partial",
    "evidence.A.visual-claims.require=visual:yes|partial",
    "evidence.B.mechanism-types=structure|dialogue",
    "evidence.creative-source.require=observed_range_creation_mode:human-directed",
    "evidence.ai-generated.finalization=false",
    "evidence.unknown-origin.finalization=false",
    "eligible_for_finalization",
    "publishable-translation",
    "internal-study",
    "licensed-recreation"
)) {
    if ($trendGateText -notmatch [regex]::Escape($marker)) {
        throw "Trend gate is missing typed evidence marker: $marker"
    }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("trend-evidence-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$script:testCaseIndex = 0

function New-TypedEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Type,
        [string]$EvidenceBasis,
        [Parameter(Mandatory = $true)][string]$Description
    )

    if ([string]::IsNullOrWhiteSpace($EvidenceBasis)) {
        $EvidenceBasis = switch -CaseSensitive ($Type) {
            "structure" { "transcript-structure" }
            "dialogue" { "transcript-dialogue" }
            "visual" { "watched-visual" }
            "action" { "watched-visual" }
            "camera" { "watched-visual" }
            "transition" { "watched-visual" }
            "performance" { "watched-visual" }
            "sound" { "watched-audio" }
            "music" { "watched-audio" }
            "audience-interaction" { "watched-interaction" }
            "topic" { "metadata-topic" }
            "packaging" { "metadata-packaging" }
            "rank" { "metadata-rank" }
            "title" { "metadata-title" }
            "cover" { "metadata-cover" }
            "secondary-claim" { "secondary-report" }
            default { "watched-visual" }
        }
    }

    return [pscustomobject][ordered]@{
        type = $Type
        evidence_basis = $EvidenceBasis
        description = $Description
    }
}

function New-EvidenceItem {
    param(
        [ValidateSet("A", "B", "C", "D")]
        [string]$Level = "A"
    )

    $item = [pscustomobject][ordered]@{
        platform = "douyin"
        source_url = "https://www.douyin.com/hot"
        captured_at = "2026-08-07T08:00:00+08:00"
        rank_or_heat = "hot-rank-1"
        published_at = "2026-08-07T07:00:00+08:00"
        evidence_level = $Level
        observation_context = "project-snapshot"
        replayed_current_turn = $false
        eligible_for_finalization = $false
        observed_range_creation_mode = "origin-unverified"
        origin_evidence = "metadata-only entry does not establish how the observed range was created"
        observed_scope = $null
        transcript_provenance = "metadata-only"
        observed_signals = @()
        verified_mechanism = @()
        saturation_risk = "low"
        freshness_risk = "low"
        rights_risk = "mechanism-only"
        reuse_boundary = "metadata-topic-packaging-only"
    }

    switch ($Level) {
        "A" {
            $item.reuse_boundary = "watched-scope-only"
            $item.observation_context = "current-turn"
            $item.replayed_current_turn = $true
            $item.eligible_for_finalization = $true
            $item.observed_range_creation_mode = "human-directed"
            $item.origin_evidence = "creator credits identify original photographed footage directed and performed by people"
            $item.observed_scope = "00:00-00:20; visual=yes; audio=no"
            $item.transcript_provenance = "watched"
            $item.observed_signals = @(
                (New-TypedEntry -Type "visual" -Description "visible countdown enters frame")
            )
            $item.verified_mechanism = @(
                (New-TypedEntry -Type "action" -Description "quantified mission begins immediately")
            )
        }
        "B" {
            $item.reuse_boundary = "transcript-structure-dialogue-only"
            $item.eligible_for_finalization = $true
            $item.observed_range_creation_mode = "human-directed"
            $item.origin_evidence = "official program credits and transcript identify a human-authored production"
            $item.transcript_provenance = "reliable-transcript"
            $item.observed_signals = @(
                (New-TypedEntry -Type "structure" -Description "setup precedes reversal")
            )
            $item.verified_mechanism = @(
                (New-TypedEntry -Type "dialogue" -Description "spoken setup is paid off later")
            )
        }
        "C" {
            $item.transcript_provenance = "metadata-only"
            $item.observed_signals = @(
                (New-TypedEntry -Type "title" -Description "title promises an impossible result")
            )
        }
        "D" {
            $item.reuse_boundary = "secondary-report-not-for-finalization"
            $item.transcript_provenance = "unlocated-secondary-report"
            $item.observed_signals = @(
                (New-TypedEntry -Type "secondary-claim" -Description "an unverified repost describes a hook")
            )
        }
    }

    return $item
}

function Invoke-EvidenceValidation {
    param([Parameter(Mandatory = $true)]$Evidence)

    $script:testCaseIndex++
    $inputPath = Join-Path $tempRoot ("case-{0:D2}.json" -f $script:testCaseIndex)
    ConvertTo-Json -InputObject $Evidence -Depth 10 | Set-Content -LiteralPath $inputPath -Encoding UTF8

    $output = @(
        & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath `
            -InputPath $inputPath `
            -Now "2026-08-07T09:00:00+08:00" `
            -MaxAgeHours 6 `
            -Format Json 2>&1
    )
    $exitCode = $LASTEXITCODE
    $outputText = $output -join [Environment]::NewLine

    try {
        $result = $outputText | ConvertFrom-Json
    }
    catch {
        throw "Validator did not return JSON. Exit code: $exitCode. Output: $outputText"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Result = $result
        Output = $outputText
    }
}

function Assert-ValidationPasses {
    param(
        [Parameter(Mandatory = $true)]$Evidence,
        [Parameter(Mandatory = $true)][string]$CaseName
    )

    $validation = Invoke-EvidenceValidation -Evidence $Evidence
    if ($validation.ExitCode -ne 0 -or $validation.Result.issueCount -ne 0) {
        throw "Expected '$CaseName' to pass. Output: $($validation.Output)"
    }
}

function Assert-ValidationFailsWith {
    param(
        [Parameter(Mandatory = $true)]$Evidence,
        [Parameter(Mandatory = $true)][string]$CaseName,
        [Parameter(Mandatory = $true)][string[]]$Rules
    )

    $validation = Invoke-EvidenceValidation -Evidence $Evidence
    if ($validation.ExitCode -ne 1) {
        throw "Expected '$CaseName' to fail with exit code 1, got $($validation.ExitCode). Output: $($validation.Output)"
    }

    $actualRules = @($validation.Result.issues | ForEach-Object { $_.rule })
    foreach ($rule in $Rules) {
        if ($actualRules -notcontains $rule) {
            throw "Expected '$CaseName' to report '$rule'. Actual rules: $($actualRules -join ', '). Output: $($validation.Output)"
        }
    }
}

try {
    $arrayScopeA = New-EvidenceItem -Level A
    $arrayScopeA.observation_context = "project-snapshot"
    $arrayScopeA.replayed_current_turn = $false
    $arrayScopeA.transcript_provenance = "watched-partial-visual"
    $arrayScopeA.observed_scope = @("00:00-00:12", "visual=partial", "audio=no")

    $validMatrix = @(
        (New-EvidenceItem -Level A),
        $arrayScopeA,
        (New-EvidenceItem -Level B),
        (New-EvidenceItem -Level C),
        (New-EvidenceItem -Level D)
    )
    Assert-ValidationPasses -Evidence $validMatrix -CaseName "valid typed A/B/C/D matrix"

    $aiGeneratedCreativeReference = New-EvidenceItem -Level A
    $aiGeneratedCreativeReference.observed_range_creation_mode = "ai-generated"
    $aiGeneratedCreativeReference.origin_evidence = "creator labels the watched clip as a text-to-video generation test"
    Assert-ValidationFailsWith -Evidence $aiGeneratedCreativeReference -CaseName "AI-generated video cannot finalize creative mechanisms" -Rules @(
        "ai-generated-reference-finalization",
        "ai-generated-reference-mechanism"
    )

    $unknownOriginCreativeReference = New-EvidenceItem -Level B
    $unknownOriginCreativeReference.observed_range_creation_mode = "origin-unverified"
    $unknownOriginCreativeReference.origin_evidence = "repost transcript has no original work, credits, or creator statement"
    Assert-ValidationFailsWith -Evidence $unknownOriginCreativeReference -CaseName "unknown-origin transcript cannot finalize story or dialogue mechanisms" -Rules @(
        "unknown-origin-reference-finalization",
        "unknown-origin-reference-mechanism"
    )

    $missingOriginEvidence = New-EvidenceItem -Level A
    $missingOriginEvidence.PSObject.Properties.Remove("origin_evidence")
    Assert-ValidationFailsWith -Evidence $missingOriginEvidence -CaseName "creative sample requires traceable origin evidence" -Rules @("missing-field")

    $invalidCreationMode = New-EvidenceItem -Level A
    $invalidCreationMode.observed_range_creation_mode = "Human-Directed"
    Assert-ValidationFailsWith -Evidence $invalidCreationMode -CaseName "creation mode enum is exact-case" -Rules @("invalid-observed-range-creation-mode")

    $validAudioOnlyA = New-EvidenceItem -Level A
    $validAudioOnlyA.observed_scope = "00:00-00:20; visual=no; audio=partial"
    $validAudioOnlyA.transcript_provenance = "watched-partial-audio"
    $validAudioOnlyA.observed_signals = @(
        (New-TypedEntry -Type "sound" -Description "bass rhythm establishes the opening pulse")
    )
    $validAudioOnlyA.verified_mechanism = @(
        (New-TypedEntry -Type "music" -Description "score changes at the task reveal")
    )
    Assert-ValidationPasses -Evidence $validAudioOnlyA -CaseName "A audio partial authorizes audio claims"

    $validAudioDialogueA = New-EvidenceItem -Level A
    $validAudioDialogueA.observed_scope = "00:00-00:20; visual=no; audio=yes"
    $validAudioDialogueA.transcript_provenance = "watched-audio"
    $validAudioDialogueA.observed_signals = @()
    $validAudioDialogueA.verified_mechanism = @(
        (New-TypedEntry -Type "dialogue" -EvidenceBasis "watched-audio" -Description "speaker withholds the name until the answer changes")
    )
    Assert-ValidationPasses -Evidence $validAudioDialogueA -CaseName "A audio verified authorizes dialogue claims"

    $validVisualOnlyA = New-EvidenceItem -Level A
    $validVisualOnlyA.observed_scope = "00:00-00:20; visual=partial; audio=no"
    $validVisualOnlyA.transcript_provenance = "watched-partial-visual"
    $validVisualOnlyA.observed_signals = @(
        (New-TypedEntry -Type "camera" -Description "orbit reveals the obstacle")
    )
    $validVisualOnlyA.verified_mechanism = @(
        (New-TypedEntry -Type "action" -Description "countdown enters the task")
    )
    Assert-ValidationPasses -Evidence $validVisualOnlyA -CaseName "A visual partial authorizes visual claims"

    $audioDeniedA = New-EvidenceItem -Level A
    $audioDeniedA.verified_mechanism = @(
        (New-TypedEntry -Type "sound" -Description "soundtrack changes at the reveal")
    )
    Assert-ValidationFailsWith -Evidence $audioDeniedA -CaseName "A audio no blocks typed sound" -Rules @(
        "a-level-unverified-audio-claim"
    )

    $visualOnlyDialogueA = New-EvidenceItem -Level A
    $visualOnlyDialogueA.verified_mechanism = @(
        (New-TypedEntry -Type "dialogue" -EvidenceBasis "watched-visual" -Description "speaker withholds the name")
    )
    Assert-ValidationFailsWith -Evidence $visualOnlyDialogueA -CaseName "A visual-only watching cannot verify dialogue" -Rules @(
        "evidence-basis-level-mismatch",
        "a-level-unverified-audio-claim"
    )

    $visualDeniedA = New-EvidenceItem -Level A
    $visualDeniedA.observed_scope = "00:00-00:20; visual=no; audio=yes"
    $visualDeniedA.transcript_provenance = "watched-audio"
    $visualDeniedA.observed_signals = @(
        (New-TypedEntry -Type "camera" -Description "camera pans across the room")
    )
    $visualDeniedA.verified_mechanism = @(
        (New-TypedEntry -Type "music" -Description "music establishes the countdown")
    )
    Assert-ValidationFailsWith -Evidence $visualDeniedA -CaseName "A visual no blocks typed camera" -Rules @(
        "a-level-unverified-visual-claim"
    )

    $hiddenAudioA = New-EvidenceItem -Level A
    $hiddenAudioA.verified_mechanism = @(
        (New-TypedEntry -Type "action" -Description "the music score rises under the task")
    )
    Assert-ValidationFailsWith -Evidence $hiddenAudioA -CaseName "A description cannot hide unverified audio" -Rules @(
        "a-level-unverified-audio-claim"
    )

    $basisClaimsAudioA = New-EvidenceItem -Level A
    $basisClaimsAudioA.verified_mechanism = @(
        (New-TypedEntry -Type "action" -EvidenceBasis "watched-visual-audio" -Description "task begins immediately")
    )
    Assert-ValidationFailsWith -Evidence $basisClaimsAudioA -CaseName "A combined basis cannot claim unverified audio" -Rules @(
        "a-level-unverified-audio-claim"
    )

    $duplicateModalityA = New-EvidenceItem -Level A
    $duplicateModalityA.observed_scope = "00:00-00:20; visual=yes; visual=no; audio=no"
    Assert-ValidationFailsWith -Evidence $duplicateModalityA -CaseName "A duplicate modality states are ambiguous" -Rules @(
        "invalid-observed-scope"
    )

    $fakeA = New-EvidenceItem -Level A
    $fakeA.replayed_current_turn = "true"
    $fakeA.transcript_provenance = "not-watched"
    $fakeA.observed_scope = "whole video"
    $fakeA.verified_mechanism = "camera move"
    Assert-ValidationFailsWith -Evidence $fakeA -CaseName "fake A scalar bypasses" -Rules @(
        "invalid-replayed-current-turn-type",
        "current-turn-not-replayed",
        "invalid-verified-mechanism-type",
        "a-level-provenance",
        "invalid-observed-scope"
    )

    $invalidMechanismEntryA = New-EvidenceItem -Level A
    $invalidMechanismEntryA.verified_mechanism = @("bad scalar", 42)
    Assert-ValidationFailsWith -Evidence $invalidMechanismEntryA -CaseName "A scalar mechanism entries" -Rules @(
        "invalid-verified-mechanism-entry"
    )

    $invalidMechanismCategoryA = New-EvidenceItem -Level A
    $invalidMechanismCategoryA.verified_mechanism = @(
        (New-TypedEntry -Type "Action" -Description "wrong case")
    )
    Assert-ValidationFailsWith -Evidence $invalidMechanismCategoryA -CaseName "A mechanism category case" -Rules @(
        "invalid-verified-mechanism-category"
    )

    $zeroWidthMechanismA = New-EvidenceItem -Level A
    $zeroWidthMechanismA.verified_mechanism = @(
        (New-TypedEntry -Type "action" -Description ([string][char]0x200B))
    )
    Assert-ValidationFailsWith -Evidence $zeroWidthMechanismA -CaseName "A semantic empty mechanism" -Rules @(
        "invalid-verified-mechanism-entry"
    )

    $emptyMechanismA = New-EvidenceItem -Level A
    $emptyMechanismA.verified_mechanism = @()
    Assert-ValidationFailsWith -Evidence $emptyMechanismA -CaseName "A empty mechanism array" -Rules @(
        "missing-verified-mechanism"
    )

    $missingVerificationStateA = New-EvidenceItem -Level A
    $missingVerificationStateA.observed_scope = "00:00-00:20"
    Assert-ValidationFailsWith -Evidence $missingVerificationStateA -CaseName "A scope without modality state" -Rules @(
        "invalid-observed-scope"
    )

    $wrongCaseScopeA = New-EvidenceItem -Level A
    $wrongCaseScopeA.observed_scope = "00:00-00:20; visual=YES; audio=no"
    Assert-ValidationFailsWith -Evidence $wrongCaseScopeA -CaseName "A scope enum casing" -Rules @(
        "invalid-observed-scope"
    )

    $unknownModalitiesA = New-EvidenceItem -Level A
    $unknownModalitiesA.observed_scope = "00:00-00:20; visual=unknown; audio=unknown"
    Assert-ValidationFailsWith -Evidence $unknownModalitiesA -CaseName "A with no verified modality" -Rules @(
        "unverified-a-level-modalities"
    )

    $reverseRangeA = New-EvidenceItem -Level A
    $reverseRangeA.observed_scope = "00:20-00:00; visual=yes; audio=yes"
    Assert-ValidationFailsWith -Evidence $reverseRangeA -CaseName "A reversed scope" -Rules @(
        "invalid-observed-scope"
    )

    $notReplayedA = New-EvidenceItem -Level A
    $notReplayedA.replayed_current_turn = $false
    Assert-ValidationFailsWith -Evidence $notReplayedA -CaseName "current-turn A not replayed" -Rules @(
        "current-turn-not-replayed"
    )

    $contextMismatchA = New-EvidenceItem -Level A
    $contextMismatchA.observation_context = "project-snapshot"
    Assert-ValidationFailsWith -Evidence $contextMismatchA -CaseName "replay context mismatch" -Rules @(
        "replayed-context-mismatch"
    )

    $unreliableB = New-EvidenceItem -Level B
    $unreliableB.transcript_provenance = "metadata-only"
    Assert-ValidationFailsWith -Evidence $unreliableB -CaseName "B without reliable transcript" -Rules @(
        "invalid-transcript-provenance"
    )

    $overclaimingB = New-EvidenceItem -Level B
    $overclaimingB.verified_mechanism = @(
        (New-TypedEntry -Type "camera" -Description "orbit reveals the actor")
    )
    Assert-ValidationFailsWith -Evidence $overclaimingB -CaseName "B visual mechanism overclaim" -Rules @(
        "b-level-unsupported-inference"
    )

    $signalOverclaimingB = New-EvidenceItem -Level B
    $signalOverclaimingB.observed_signals = @(
        (New-TypedEntry -Type "performance" -Description "actor raises an eyebrow")
    )
    Assert-ValidationFailsWith -Evidence $signalOverclaimingB -CaseName "B visual signal overclaim" -Rules @(
        "b-level-unsupported-inference"
    )

    $descriptionOverclaimingB = New-EvidenceItem -Level B
    $descriptionOverclaimingB.verified_mechanism = @(
        (New-TypedEntry -Type "structure" -EvidenceBasis "transcript-structure" -Description "camera orbit reveals the actor")
    )
    Assert-ValidationFailsWith -Evidence $descriptionOverclaimingB -CaseName "B legal type cannot hide camera claim" -Rules @(
        "b-level-description-overclaim"
    )

    $basisOverclaimingB = New-EvidenceItem -Level B
    $basisOverclaimingB.verified_mechanism = @(
        (New-TypedEntry -Type "structure" -EvidenceBasis "watched-visual" -Description "setup precedes reversal")
    )
    Assert-ValidationFailsWith -Evidence $basisOverclaimingB -CaseName "B legal type requires transcript basis" -Rules @(
        "evidence-basis-level-mismatch"
    )

    $scopeOverclaimingB = New-EvidenceItem -Level B
    $scopeOverclaimingB.observed_scope = "00:00-00:20; visual=yes; audio=yes"
    Assert-ValidationFailsWith -Evidence $scopeOverclaimingB -CaseName "B watched scope overclaim" -Rules @(
        "b-level-observed-scope"
    )

    $overclaimingC = New-EvidenceItem -Level C
    $overclaimingC.transcript_provenance = "reliable-transcript"
    $overclaimingC.observed_scope = "00:00-00:10; visual=yes; audio=no"
    $overclaimingC.observed_signals = @(
        (New-TypedEntry -Type "camera" -Description "camera orbit")
    )
    $overclaimingC.verified_mechanism = @(
        (New-TypedEntry -Type "visual" -Description "visual hook")
    )
    $overclaimingC.eligible_for_finalization = $true
    $overclaimingC.reuse_boundary = "approved finalization mechanism"
    Assert-ValidationFailsWith -Evidence $overclaimingC -CaseName "C metadata overclaim" -Rules @(
        "c-level-provenance",
        "c-level-observed-scope",
        "c-level-observed-signal",
        "c-level-verified-mechanism",
        "c-level-finalization-eligibility",
        "c-level-reuse-boundary"
    )

    $descriptionOverclaimingC = New-EvidenceItem -Level C
    $descriptionOverclaimingC.observed_signals = @(
        (New-TypedEntry -Type "title" -EvidenceBasis "metadata-title" -Description "actor performance raises an eyebrow")
    )
    Assert-ValidationFailsWith -Evidence $descriptionOverclaimingC -CaseName "C legal metadata type cannot hide performance claim" -Rules @(
        "c-level-description-overclaim"
    )

    $overclaimingD = New-EvidenceItem -Level D
    $overclaimingD.observed_scope = "00:00-00:10; visual=yes; audio=yes"
    $overclaimingD.observed_signals = @(
        (New-TypedEntry -Type "topic" -Description "viral topic")
    )
    $overclaimingD.verified_mechanism = @(
        (New-TypedEntry -Type "structure" -Description "copy exact hook")
    )
    $overclaimingD.eligible_for_finalization = $true
    $overclaimingD.reuse_boundary = "approved finalization mechanism"
    Assert-ValidationFailsWith -Evidence $overclaimingD -CaseName "D finalization overclaim" -Rules @(
        "d-level-observed-scope",
        "d-level-observed-signal",
        "d-level-finalization-mechanism",
        "d-level-finalization-eligibility",
        "d-level-reuse-boundary"
    )

    $descriptionOverclaimingD = New-EvidenceItem -Level D
    $descriptionOverclaimingD.observed_signals = @(
        (New-TypedEntry -Type "secondary-claim" -EvidenceBasis "secondary-report" -Description "music soundtrack was heard in the verified video")
    )
    Assert-ValidationFailsWith -Evidence $descriptionOverclaimingD -CaseName "D legal secondary type cannot hide audio claim" -Rules @(
        "d-level-description-overclaim"
    )

    $missingEvidenceBasisA = New-EvidenceItem -Level A
    $missingEvidenceBasisA.verified_mechanism = @(
        [pscustomobject][ordered]@{
            type = "action"
            description = "task begins immediately"
        }
    )
    Assert-ValidationFailsWith -Evidence $missingEvidenceBasisA -CaseName "typed entry missing structural evidence basis" -Rules @(
        "invalid-verified-mechanism-entry"
    )

    $invalidSignalContainer = New-EvidenceItem -Level A
    $invalidSignalContainer.observed_signals = "visual hook"
    Assert-ValidationFailsWith -Evidence $invalidSignalContainer -CaseName "signal scalar container" -Rules @(
        "invalid-observed-signals-type"
    )

    $typeConfusionA = New-EvidenceItem -Level A
    $typeConfusionA.platform = @("douyin")
    $typeConfusionA.source_url = @("https://www.douyin.com/hot")
    $typeConfusionA.captured_at = @("2026-08-07T08:00:00+08:00")
    $typeConfusionA.evidence_level = @("A")
    $typeConfusionA.observation_context = @("current-turn")
    $typeConfusionA.freshness_risk = 42
    $typeConfusionA.rights_risk = $true
    Assert-ValidationFailsWith -Evidence $typeConfusionA -CaseName "required scalar type confusion" -Rules @(
        "invalid-scalar-field-type"
    )

    $wrongCaseA = New-EvidenceItem -Level A
    $wrongCaseA.evidence_level = "a"
    $wrongCaseA.observation_context = "CURRENT-TURN"
    Assert-ValidationFailsWith -Evidence $wrongCaseA -CaseName "enum case confusion" -Rules @(
        "invalid-evidence-level",
        "invalid-observation-context"
    )

    $invalidEligibilityC = New-EvidenceItem -Level C
    $invalidEligibilityC.eligible_for_finalization = "false"
    Assert-ValidationFailsWith -Evidence $invalidEligibilityC -CaseName "eligibility string boolean" -Rules @(
        "invalid-eligible-for-finalization-type"
    )

    $invalidLegacyCase = New-EvidenceItem -Level A
    $invalidLegacyCase.source_url = "http://example.com/video"
    $invalidLegacyCase.captured_at = "2026-08-05T08:00:00+08:00"
    $invalidLegacyCase.rank_or_heat = $null
    $invalidLegacyCase.observed_scope = $null
    Assert-ValidationFailsWith -Evidence $invalidLegacyCase -CaseName "URL freshness and required A scope" -Rules @(
        "invalid-source-url",
        "stale-evidence",
        "invalid-scalar-field-type",
        "missing-observed-scope"
    )

    "Trend evidence validator tests passed."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
