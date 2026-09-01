param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [double]$MaxAgeHours = 24,
    [string]$Now,
    [ValidateSet("Text", "Json")]
    [string]$Format = "Text"
)

$ErrorActionPreference = "Stop"

function Add-Issue {
    param([string]$Rule, [int]$Index, [string]$Message)
    $script:issues += [pscustomobject]@{
        rule = $Rule
        index = $Index
        message = $Message
    }
}

function Test-JsonObject {
    param($Value)
    return $Value -is [System.Management.Automation.PSCustomObject]
}

function Get-SemanticText {
    param($Value)

    if ($Value -isnot [string]) {
        return $null
    }

    $normalized = $Value.Normalize([System.Text.NormalizationForm]::FormKC)
    return ([regex]::Replace($normalized, '[\p{Cf}\p{Cc}]', '')).Trim()
}

function Test-MeaningfulString {
    param($Value)

    if ($Value -isnot [string]) {
        return $false
    }
    $text = Get-SemanticText -Value $Value
    return -not [string]::IsNullOrWhiteSpace($text)
}

function Convert-ObservedTimecodeToSeconds {
    param([string]$Value)

    $parts = @($Value -split ":")
    if ($parts.Count -notin @(2, 3)) {
        return -1
    }

    $numbers = @()
    foreach ($part in $parts) {
        [int]$number = 0
        if (-not [int]::TryParse($part, [ref]$number) -or $number -lt 0) {
            return -1
        }
        $numbers += $number
    }

    if ($numbers[-1] -gt 59) {
        return -1
    }
    if ($numbers.Count -eq 2) {
        return ($numbers[0] * 60) + $numbers[1]
    }
    if ($numbers[1] -gt 59) {
        return -1
    }
    return ($numbers[0] * 3600) + ($numbers[1] * 60) + $numbers[2]
}

function Get-ObservedScopeState {
    param($Value, [int]$Index)

    $entries = @()
    $isValid = $true
    if ($null -eq $Value) {
        return [pscustomobject]@{ IsValid = $true; Entries = @(); Text = "" }
    }
    if ($Value -is [string]) {
        $entries = @($Value)
    }
    elseif ($Value -is [System.Array]) {
        $entries = @($Value)
    }
    else {
        Add-Issue -Rule "invalid-observed-scope-type" -Index $Index -Message "observed_scope must be null, a JSON string, or an array of JSON strings."
        return [pscustomobject]@{ IsValid = $false; Entries = @(); Text = "" }
    }

    foreach ($entry in $entries) {
        if (-not (Test-MeaningfulString -Value $entry)) {
            Add-Issue -Rule "invalid-observed-scope-entry" -Index $Index -Message "Every observed_scope entry must be a semantically non-empty JSON string."
            $isValid = $false
            break
        }
    }

    return [pscustomobject]@{
        IsValid = $isValid
        Entries = @($entries)
        Text = if ($isValid) { $entries -join "; " } else { "" }
    }
}

function Test-WatchedObservedScope {
    param([string]$Value)

    $rangePattern = '(?<!\d)(?<start>(?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(?<end>(?:\d{1,2}:)?\d{1,2}:\d{2})(?!\d)'
    $hasValidRange = $false
    foreach ($match in [regex]::Matches($Value, $rangePattern)) {
        $startSeconds = Convert-ObservedTimecodeToSeconds -Value $match.Groups["start"].Value
        $endSeconds = Convert-ObservedTimecodeToSeconds -Value $match.Groups["end"].Value
        if ($startSeconds -ge 0 -and $endSeconds -gt $startSeconds) {
            $hasValidRange = $true
            break
        }
    }
    if (-not $hasValidRange) {
        return $false
    }

    $state = '(?:yes|no|partial|unknown)'
    if (@([regex]::Matches($Value, "\bvisual\s*=\s*$state\b", [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)).Count -ne 1) {
        return $false
    }
    if (@([regex]::Matches($Value, "\baudio\s*=\s*$state\b", [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)).Count -ne 1) {
        return $false
    }
    return $true
}

function Get-WatchedModalityState {
    param(
        [string]$Value,
        [ValidateSet("visual", "audio")]
        [string]$Modality
    )

    $pattern = "\b$Modality\s*=\s*(?<state>yes|no|partial|unknown)\b"
    $matches = @([regex]::Matches($Value, $pattern, [System.Text.RegularExpressions.RegexOptions]::CultureInvariant))
    if ($matches.Count -ne 1) {
        return ""
    }
    return $matches[0].Groups["state"].Value
}

function Test-DescriptionMatches {
    param(
        [string]$Description,
        [string]$Pattern
    )

    $text = Get-SemanticText -Value $Description
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $false
    }
    return [regex]::IsMatch(
        $text,
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )
}

function Test-EntryBasisForLevel {
    param(
        [string]$Level,
        [string]$Type,
        [string]$EvidenceBasis
    )

    if ($Level -ceq "A") {
        if ($Type -cin @("visual", "action", "camera", "transition", "performance")) {
            return $EvidenceBasis -cin @("watched-visual", "watched-visual-audio")
        }
        if ($Type -cin @("sound", "music")) {
            return $EvidenceBasis -cin @("watched-audio", "watched-visual-audio")
        }
        if ($Type -ceq "structure") {
            return $EvidenceBasis -cin @("watched-visual", "watched-audio", "watched-visual-audio")
        }
        if ($Type -ceq "dialogue") {
            return $EvidenceBasis -cin @("watched-audio", "watched-visual-audio")
        }
        if ($Type -ceq "audience-interaction") {
            return $EvidenceBasis -cin @("watched-visual", "watched-audio", "watched-visual-audio", "watched-interaction")
        }
        $metadataBasisByType = @{
            "topic" = "metadata-topic"
            "packaging" = "metadata-packaging"
            "rank" = "metadata-rank"
            "title" = "metadata-title"
            "cover" = "metadata-cover"
        }
        return $metadataBasisByType.ContainsKey($Type) -and $EvidenceBasis -ceq $metadataBasisByType[$Type]
    }

    if ($Level -ceq "B") {
        return ($Type -ceq "structure" -and $EvidenceBasis -ceq "transcript-structure") -or
            ($Type -ceq "dialogue" -and $EvidenceBasis -ceq "transcript-dialogue")
    }

    if ($Level -ceq "C") {
        $metadataBasisByType = @{
            "topic" = "metadata-topic"
            "packaging" = "metadata-packaging"
            "rank" = "metadata-rank"
            "title" = "metadata-title"
            "cover" = "metadata-cover"
        }
        return $metadataBasisByType.ContainsKey($Type) -and $EvidenceBasis -ceq $metadataBasisByType[$Type]
    }

    if ($Level -ceq "D") {
        return $Type -ceq "secondary-claim" -and $EvidenceBasis -ceq "secondary-report"
    }

    return $false
}

function Get-TypedEntryArrayState {
    param(
        $Value,
        [int]$Index,
        [string]$Field,
        [string]$TypeRule,
        [string]$EntryRule,
        [string]$CategoryRule,
        [string[]]$AllowedTypes,
        [string[]]$AllowedEvidenceBases
    )

    if ($Value -isnot [System.Array]) {
        Add-Issue -Rule $TypeRule -Index $Index -Message "$Field must be a JSON array of objects with type, evidence_basis, and description strings."
        return [pscustomobject]@{ IsArray = $false; IsValid = $false; Entries = @() }
    }

    $entries = @()
    $isValid = $true
    foreach ($entry in @($Value)) {
        if (-not (Test-JsonObject -Value $entry)) {
            Add-Issue -Rule $EntryRule -Index $Index -Message "Every $Field entry must be a JSON object with type, evidence_basis, and description."
            $isValid = $false
            continue
        }

        $propertyNames = @($entry.PSObject.Properties.Name)
        $typeIsValidString = ($propertyNames -contains "type") -and (Test-MeaningfulString -Value $entry.type)
        $basisIsValidString = ($propertyNames -contains "evidence_basis") -and (Test-MeaningfulString -Value $entry.evidence_basis)
        $descriptionIsValidString = ($propertyNames -contains "description") -and (Test-MeaningfulString -Value $entry.description)
        $unknownProperties = @($propertyNames | Where-Object { $_ -cnotin @("type", "evidence_basis", "description") })
        if (-not $typeIsValidString -or -not $basisIsValidString -or -not $descriptionIsValidString -or $unknownProperties.Count -gt 0) {
            Add-Issue -Rule $EntryRule -Index $Index -Message "Every $Field entry needs only semantically non-empty JSON string properties type, evidence_basis, and description."
            $isValid = $false
            continue
        }

        $type = [string]$entry.type
        $evidenceBasis = [string]$entry.evidence_basis
        if ($type -cnotin $AllowedTypes) {
            Add-Issue -Rule $CategoryRule -Index $Index -Message "$Field type '$type' is not an allowed exact-case category."
            $isValid = $false
        }
        if ($evidenceBasis -cnotin $AllowedEvidenceBases) {
            Add-Issue -Rule "invalid-evidence-basis" -Index $Index -Message "$Field evidence_basis '$evidenceBasis' is not an allowed exact-case category."
            $isValid = $false
        }
        $entries += [pscustomobject]@{
            Type = $type
            EvidenceBasis = $evidenceBasis
            Description = [string]$entry.description
        }
    }

    return [pscustomobject]@{
        IsArray = $true
        IsValid = $isValid
        Entries = @($entries)
    }
}

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Missing trend evidence file: $InputPath"
}

$data = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($data -is [System.Array]) {
    $items = @($data)
}
elseif ((Test-JsonObject -Value $data) -and @($data.PSObject.Properties.Name) -contains "items") {
    if ($data.items -isnot [System.Array]) {
        throw "Trend evidence wrapper property items must be a JSON array."
    }
    $items = @($data.items)
}
else {
    $items = @($data)
}

if ($items.Count -eq 0) {
    throw "Trend evidence must contain at least one item."
}

$nowValue = if ([string]::IsNullOrWhiteSpace($Now)) {
    [DateTimeOffset]::Now
}
else {
    [DateTimeOffset]::Parse($Now)
}

$issues = @()
$requiredStringFields = @(
    "platform",
    "source_url",
    "captured_at",
    "rank_or_heat",
    "published_at",
    "evidence_level",
    "observation_context",
    "observed_range_creation_mode",
    "origin_evidence",
    "transcript_provenance",
    "freshness_risk",
    "rights_risk",
    "reuse_boundary"
)
$requiredProperties = @(
    "observed_scope",
    "verified_mechanism",
    "replayed_current_turn",
    "eligible_for_finalization"
)
$mechanismTypes = @(
    "structure",
    "dialogue",
    "visual",
    "action",
    "camera",
    "transition",
    "performance",
    "sound",
    "music",
    "audience-interaction"
)
$signalTypes = @(
    "structure",
    "dialogue",
    "visual",
    "action",
    "camera",
    "transition",
    "performance",
    "sound",
    "music",
    "audience-interaction",
    "topic",
    "packaging",
    "rank",
    "title",
    "cover",
    "secondary-claim"
)
$evidenceBasisTypes = @(
    "watched-visual",
    "watched-audio",
    "watched-visual-audio",
    "watched-interaction",
    "transcript-structure",
    "transcript-dialogue",
    "metadata-topic",
    "metadata-packaging",
    "metadata-rank",
    "metadata-title",
    "metadata-cover",
    "secondary-report"
)

# Free text is display-only. These normalized patterns are a defense-in-depth
# linter; the primary authorization boundary is the exact type/evidence_basis
# tuple validated below.
$visualClaimPattern = '(?:\b(?:visuals?|visually|visible|camera|camerawork|shots?|close[- ]?ups?|wide[- ]?shots?|orbit(?:s|ed|ing)?|pan(?:s|ned|ning)?|tilt(?:s|ed|ing)?|zoom(?:s|ed|ing)?|dolly|tracking[- ]?shot|framing|composition|lighting|actor|actress|performance|gesture|eyebrow|action|fight|choreograph(?:y|ed|ing)|transition|cut)\b|\u753b\u9762|\u89c6\u89c9|\u955c\u5934|\u8fd0\u955c|\u6444\u5f71|\u6784\u56fe|\u5149\u7ebf|\u8868\u6f14|\u6f14\u5458|\u52a8\u4f5c|\u6253\u6597|\u8f6c\u573a)'
$audioClaimPattern = '(?:\b(?:audio|sound|sounds|soundtrack|soundscape|sfx|music|musical|song|score|bgm|voice|vocal|audible|heard|hearing|beat|rhythm|melody)\b|\u58f0\u97f3|\u97f3\u9891|\u97f3\u4e50|\u6b4c\u66f2|\u914d\u4e50|\u97f3\u6548|\u58f0\u7eb9|\u4eba\u58f0|\u542c\u5230|\u9f13\u70b9|\u65cb\u5f8b)'
$narrativeClaimPattern = '(?:\b(?:structure|structural|dialogue|narrative|setup|reversal|payoff|spoken[- ]?line|story[- ]?beat)\b|\u7ed3\u6784|\u53f0\u8bcd|\u5bf9\u767d|\u53d9\u4e8b|\u94fa\u57ab|\u53cd\u8f6c|\u5151\u73b0)'

for ($i = 0; $i -lt $items.Count; $i++) {
    $item = $items[$i]
    if (-not (Test-JsonObject -Value $item)) {
        Add-Issue -Rule "invalid-item-type" -Index $i -Message "Every trend evidence item must be a JSON object."
        continue
    }

    $propertyNames = @($item.PSObject.Properties.Name)
    foreach ($field in $requiredStringFields) {
        if ($propertyNames -notcontains $field) {
            Add-Issue -Rule "missing-field" -Index $i -Message "Missing required field '$field'."
        }
        elseif ($item.$field -isnot [string]) {
            Add-Issue -Rule "invalid-scalar-field-type" -Index $i -Message "$field must be a JSON string."
        }
        elseif (-not (Test-MeaningfulString -Value $item.$field)) {
            Add-Issue -Rule "missing-field" -Index $i -Message "Required field '$field' must be semantically non-empty."
        }
    }
    foreach ($propertyName in $requiredProperties) {
        if ($propertyNames -notcontains $propertyName) {
            Add-Issue -Rule "missing-property" -Index $i -Message "Missing required property '$propertyName'."
        }
    }

    foreach ($optionalStringField in @("saturation_risk")) {
        if ($propertyNames -contains $optionalStringField) {
            if ($item.$optionalStringField -isnot [string] -or -not (Test-MeaningfulString -Value $item.$optionalStringField)) {
                Add-Issue -Rule "invalid-scalar-field-type" -Index $i -Message "$optionalStringField must be a semantically non-empty JSON string when present."
            }
        }
    }
    if (($propertyNames -contains "saturation_risk") -and
        $item.saturation_risk -is [string] -and
        $item.saturation_risk -cnotin @("low", "medium", "high")) {
        Add-Issue -Rule "invalid-saturation-risk" -Index $i -Message "saturation_risk must be low, medium, or high with exact casing."
    }

    $uri = $null
    if (($propertyNames -contains "source_url") -and $item.source_url -is [string] -and (Test-MeaningfulString -Value $item.source_url)) {
        if (-not [Uri]::TryCreate($item.source_url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -cne "https") {
            Add-Issue -Rule "invalid-source-url" -Index $i -Message "source_url must be an absolute HTTPS URL."
        }
    }

    $captured = [DateTimeOffset]::MinValue
    if (($propertyNames -contains "captured_at") -and $item.captured_at -is [string] -and (Test-MeaningfulString -Value $item.captured_at)) {
        if ($item.captured_at -notmatch "(?:[zZ]|[+-]\d{2}:\d{2})$") {
            Add-Issue -Rule "missing-captured-at-timezone" -Index $i -Message "captured_at must include Z or an explicit UTC offset."
        }
        if (-not [DateTimeOffset]::TryParse($item.captured_at, [ref]$captured)) {
            Add-Issue -Rule "invalid-captured-at" -Index $i -Message "captured_at must be an ISO-8601 timestamp with timezone."
        }
        else {
            $age = $nowValue - $captured
            if ($age.TotalMinutes -lt -5) {
                Add-Issue -Rule "future-captured-at" -Index $i -Message "captured_at is later than the validation clock."
            }
            elseif ($age.TotalHours -gt $MaxAgeHours) {
                Add-Issue -Rule "stale-evidence" -Index $i -Message "Evidence is $([Math]::Round($age.TotalHours, 1)) hours old; maximum is $MaxAgeHours."
            }
        }
    }

    $level = if ($item.evidence_level -is [string]) { [string]$item.evidence_level } else { "" }
    if (-not [string]::IsNullOrEmpty($level) -and $level -cnotmatch "^[ABCD]$") {
        Add-Issue -Rule "invalid-evidence-level" -Index $i -Message "evidence_level must be exact-case A, B, C, or D."
    }

    $observationContext = if ($item.observation_context -is [string]) { [string]$item.observation_context } else { "" }
    if (-not [string]::IsNullOrEmpty($observationContext) -and
        $observationContext -cnotin @("current-turn", "project-snapshot", "user-provided")) {
        Add-Issue -Rule "invalid-observation-context" -Index $i -Message "observation_context must use an exact-case allowed value."
    }

    $replayedIsBoolean = ($propertyNames -contains "replayed_current_turn") -and
        $item.replayed_current_turn -is [System.Boolean]
    if (($propertyNames -contains "replayed_current_turn") -and -not $replayedIsBoolean) {
        Add-Issue -Rule "invalid-replayed-current-turn-type" -Index $i -Message "replayed_current_turn must be a JSON boolean."
    }
    if ($replayedIsBoolean) {
        if ($observationContext -ceq "current-turn" -and -not $item.replayed_current_turn) {
            Add-Issue -Rule "current-turn-not-replayed" -Index $i -Message "current-turn evidence must set replayed_current_turn to true."
        }
        elseif ($observationContext -cin @("project-snapshot", "user-provided") -and $item.replayed_current_turn) {
            Add-Issue -Rule "replayed-context-mismatch" -Index $i -Message "replayed_current_turn=true requires observation_context=current-turn."
        }
    }
    elseif ($observationContext -ceq "current-turn") {
        Add-Issue -Rule "current-turn-not-replayed" -Index $i -Message "current-turn evidence must set replayed_current_turn to the JSON boolean true."
    }

    $eligibleIsBoolean = ($propertyNames -contains "eligible_for_finalization") -and
        $item.eligible_for_finalization -is [System.Boolean]
    if (($propertyNames -contains "eligible_for_finalization") -and -not $eligibleIsBoolean) {
        Add-Issue -Rule "invalid-eligible-for-finalization-type" -Index $i -Message "eligible_for_finalization must be a JSON boolean."
    }

    $creationMode = if ($item.observed_range_creation_mode -is [string]) {
        [string]$item.observed_range_creation_mode
    }
    else {
        ""
    }
    if (-not [string]::IsNullOrEmpty($creationMode) -and
        $creationMode -cnotin @("human-directed", "ai-generated", "origin-unverified")) {
        Add-Issue -Rule "invalid-observed-range-creation-mode" -Index $i -Message "observed_range_creation_mode must be exactly human-directed, ai-generated, or origin-unverified."
    }

    $scopeState = Get-ObservedScopeState -Value $item.observed_scope -Index $i
    $mechanismState = if ($propertyNames -contains "verified_mechanism") {
        Get-TypedEntryArrayState -Value $item.verified_mechanism -Index $i -Field "verified_mechanism" `
            -TypeRule "invalid-verified-mechanism-type" -EntryRule "invalid-verified-mechanism-entry" `
            -CategoryRule "invalid-verified-mechanism-category" -AllowedTypes $mechanismTypes `
            -AllowedEvidenceBases $evidenceBasisTypes
    }
    else {
        [pscustomobject]@{ IsArray = $false; IsValid = $false; Entries = @() }
    }

    $signalState = if ($propertyNames -contains "observed_signals") {
        Get-TypedEntryArrayState -Value $item.observed_signals -Index $i -Field "observed_signals" `
            -TypeRule "invalid-observed-signals-type" -EntryRule "invalid-observed-signal-entry" `
            -CategoryRule "invalid-observed-signal-category" -AllowedTypes $signalTypes `
            -AllowedEvidenceBases $evidenceBasisTypes
    }
    else {
        [pscustomobject]@{ IsArray = $true; IsValid = $true; Entries = @() }
    }

    $typedEntries = @($mechanismState.Entries) + @($signalState.Entries)
    if ($creationMode -cin @("ai-generated", "origin-unverified")) {
        if ($eligibleIsBoolean -and $item.eligible_for_finalization) {
            $rule = if ($creationMode -ceq "ai-generated") { "ai-generated-reference-finalization" } else { "unknown-origin-reference-finalization" }
            Add-Issue -Rule $rule -Index $i -Message "Only observed_range_creation_mode=human-directed may set eligible_for_finalization=true for creative research."
        }
        if ($mechanismState.IsArray -and $mechanismState.Entries.Count -gt 0) {
            $rule = if ($creationMode -ceq "ai-generated") { "ai-generated-reference-mechanism" } else { "unknown-origin-reference-mechanism" }
            Add-Issue -Rule $rule -Index $i -Message "AI-generated or unknown-origin samples cannot provide verified creative mechanisms; use a separate generationBenchmarkSet for technical findings."
        }
    }
    $basisMismatches = @($typedEntries | Where-Object {
        -not (Test-EntryBasisForLevel -Level $level -Type $_.Type -EvidenceBasis $_.EvidenceBasis)
    })
    if ($basisMismatches.Count -gt 0) {
        Add-Issue -Rule "evidence-basis-level-mismatch" -Index $i -Message "Every typed entry must use the exact evidence_basis allowed for its evidence level and type."
    }

    $provenance = if ($item.transcript_provenance -is [string]) { [string]$item.transcript_provenance } else { "" }
    if ($level -ceq "A") {
        if ($item.reuse_boundary -is [string] -and $item.reuse_boundary -cne "watched-scope-only") {
            Add-Issue -Rule "a-level-reuse-boundary" -Index $i -Message "A-level evidence must use reuse_boundary=watched-scope-only."
        }
        $watchedProvenance = @(
            "watched",
            "watched-visual",
            "watched-audio",
            "watched-visual-audio",
            "watched-partial-visual",
            "watched-partial-audio",
            "watched-partial-visual-audio"
        )
        if ($provenance -cnotin $watchedProvenance) {
            Add-Issue -Rule "a-level-provenance" -Index $i -Message "A-level evidence requires an exact-case watched provenance value."
        }
        if (-not $scopeState.IsValid -or $scopeState.Entries.Count -eq 0) {
            Add-Issue -Rule "missing-observed-scope" -Index $i -Message "A-level evidence must record a watched range and modality states."
        }
        elseif (-not (Test-WatchedObservedScope -Value $scopeState.Text)) {
            Add-Issue -Rule "invalid-observed-scope" -Index $i -Message "A-level observed_scope needs an increasing range plus exact-case visual/audio states."
        }
        elseif ($scopeState.Text -cnotmatch '\b(?:visual|audio)\s*=\s*(?:yes|partial)\b') {
            Add-Issue -Rule "unverified-a-level-modalities" -Index $i -Message "A-level evidence must verify at least one modality as yes or partial."
        }
        else {
            $visualState = Get-WatchedModalityState -Value $scopeState.Text -Modality "visual"
            $audioState = Get-WatchedModalityState -Value $scopeState.Text -Modality "audio"
            $visualIsVerified = $visualState -cin @("yes", "partial")
            $audioIsVerified = $audioState -cin @("yes", "partial")
            $watchedEntries = @($typedEntries | Where-Object { $_.EvidenceBasis -clike "watched-*" })

            $claimsVisual = @($watchedEntries | Where-Object {
                $_.EvidenceBasis -cin @("watched-visual", "watched-visual-audio") -or
                    $_.Type -cin @("visual", "action", "camera", "transition", "performance") -or
                    (Test-DescriptionMatches -Description $_.Description -Pattern $visualClaimPattern)
            })
            if (-not $visualIsVerified -and $claimsVisual.Count -gt 0) {
                Add-Issue -Rule "a-level-unverified-visual-claim" -Index $i -Message "A-level visual/action/camera/transition/performance claims require visual=yes or visual=partial."
            }

            $claimsAudio = @($watchedEntries | Where-Object {
                $_.EvidenceBasis -cin @("watched-audio", "watched-visual-audio") -or
                    $_.Type -cin @("dialogue", "sound", "music") -or
                    (Test-DescriptionMatches -Description $_.Description -Pattern $audioClaimPattern)
            })
            if (-not $audioIsVerified -and $claimsAudio.Count -gt 0) {
                Add-Issue -Rule "a-level-unverified-audio-claim" -Index $i -Message "A-level dialogue/sound/music claims require audio=yes or audio=partial."
            }
        }
        if ($mechanismState.IsArray -and $mechanismState.IsValid -and $mechanismState.Entries.Count -eq 0) {
            Add-Issue -Rule "missing-verified-mechanism" -Index $i -Message "A-level evidence needs at least one typed verified mechanism."
        }
        if (@($signalState.Entries | Where-Object { $_.Type -ceq "secondary-claim" }).Count -gt 0) {
            Add-Issue -Rule "a-level-observed-signal" -Index $i -Message "A-level observed_signals cannot use secondary-claim."
        }
    }
    elseif ($level -ceq "B") {
        if ($item.reuse_boundary -is [string] -and $item.reuse_boundary -cne "transcript-structure-dialogue-only") {
            Add-Issue -Rule "b-level-reuse-boundary" -Index $i -Message "B-level evidence must use reuse_boundary=transcript-structure-dialogue-only."
        }
        if ($provenance -cnotin @("official-transcript", "reliable-transcript")) {
            Add-Issue -Rule "invalid-transcript-provenance" -Index $i -Message "B-level evidence requires official-transcript or reliable-transcript."
        }
        if ($scopeState.IsValid -and $scopeState.Text -match '(?i)\b(?:visual|audio)\s*=') {
            Add-Issue -Rule "b-level-observed-scope" -Index $i -Message "B-level transcript evidence cannot claim visual or audio watched scope."
        }
        $unsupportedBMechanisms = @($mechanismState.Entries | Where-Object { $_.Type -cnotin @("structure", "dialogue") })
        $unsupportedBSignals = @($signalState.Entries | Where-Object { $_.Type -cnotin @("structure", "dialogue") })
        if ($unsupportedBMechanisms.Count -gt 0 -or $unsupportedBSignals.Count -gt 0) {
            Add-Issue -Rule "b-level-unsupported-inference" -Index $i -Message "B-level evidence may type only structure or dialogue mechanisms and signals."
        }
        if (@($typedEntries | Where-Object {
            (Test-DescriptionMatches -Description $_.Description -Pattern $visualClaimPattern) -or
                (Test-DescriptionMatches -Description $_.Description -Pattern $audioClaimPattern)
        }).Count -gt 0) {
            Add-Issue -Rule "b-level-description-overclaim" -Index $i -Message "B-level descriptions cannot carry visual, action, camera, performance, sound, or music claims outside the typed transcript boundary."
        }
    }
    elseif ($level -ceq "C") {
        if ($item.reuse_boundary -is [string] -and $item.reuse_boundary -cne "metadata-topic-packaging-only") {
            Add-Issue -Rule "c-level-reuse-boundary" -Index $i -Message "C-level evidence must use reuse_boundary=metadata-topic-packaging-only."
        }
        if ($provenance -cne "metadata-only") {
            Add-Issue -Rule "c-level-provenance" -Index $i -Message "C-level evidence must use metadata-only provenance."
        }
        if ($scopeState.IsValid -and $scopeState.Entries.Count -gt 0) {
            Add-Issue -Rule "c-level-observed-scope" -Index $i -Message "C-level metadata must not claim observed_scope."
        }
        if ($mechanismState.IsArray -and $mechanismState.Entries.Count -gt 0) {
            Add-Issue -Rule "c-level-verified-mechanism" -Index $i -Message "C-level metadata cannot claim a verified mechanism."
        }
        if (@($signalState.Entries | Where-Object { $_.Type -cnotin @("topic", "packaging", "rank", "title", "cover") }).Count -gt 0) {
            Add-Issue -Rule "c-level-observed-signal" -Index $i -Message "C-level observed_signals may type only topic, packaging, rank, title, or cover."
        }
        if (@($typedEntries | Where-Object {
            (Test-DescriptionMatches -Description $_.Description -Pattern $visualClaimPattern) -or
                (Test-DescriptionMatches -Description $_.Description -Pattern $audioClaimPattern) -or
                (Test-DescriptionMatches -Description $_.Description -Pattern $narrativeClaimPattern)
        }).Count -gt 0) {
            Add-Issue -Rule "c-level-description-overclaim" -Index $i -Message "C-level descriptions cannot smuggle audiovisual, performance, dialogue, or narrative claims into metadata categories."
        }
        if ($eligibleIsBoolean -and $item.eligible_for_finalization) {
            Add-Issue -Rule "c-level-finalization-eligibility" -Index $i -Message "C-level evidence must set eligible_for_finalization to false."
        }
    }
    elseif ($level -ceq "D") {
        if ($item.reuse_boundary -is [string] -and $item.reuse_boundary -cne "secondary-report-not-for-finalization") {
            Add-Issue -Rule "d-level-reuse-boundary" -Index $i -Message "D-level evidence must use reuse_boundary=secondary-report-not-for-finalization."
        }
        if ($provenance -cnotin @("secondary-report", "unlocated-secondary-report")) {
            Add-Issue -Rule "d-level-provenance" -Index $i -Message "D-level evidence requires a secondary-report provenance value."
        }
        if ($scopeState.IsValid -and $scopeState.Entries.Count -gt 0) {
            Add-Issue -Rule "d-level-observed-scope" -Index $i -Message "D-level secondary reporting must not claim observed_scope."
        }
        if ($mechanismState.IsArray -and $mechanismState.Entries.Count -gt 0) {
            Add-Issue -Rule "d-level-finalization-mechanism" -Index $i -Message "D-level evidence cannot supply a verified mechanism."
        }
        if (@($signalState.Entries | Where-Object { $_.Type -cne "secondary-claim" }).Count -gt 0) {
            Add-Issue -Rule "d-level-observed-signal" -Index $i -Message "D-level observed_signals may type only secondary-claim."
        }
        if (@($typedEntries | Where-Object {
            (Test-DescriptionMatches -Description $_.Description -Pattern $visualClaimPattern) -or
                (Test-DescriptionMatches -Description $_.Description -Pattern $audioClaimPattern) -or
                (Test-DescriptionMatches -Description $_.Description -Pattern $narrativeClaimPattern)
        }).Count -gt 0) {
            Add-Issue -Rule "d-level-description-overclaim" -Index $i -Message "D-level descriptions cannot smuggle audiovisual, performance, dialogue, or narrative claims into secondary-claim."
        }
        if ($eligibleIsBoolean -and $item.eligible_for_finalization) {
            Add-Issue -Rule "d-level-finalization-eligibility" -Index $i -Message "D-level evidence must set eligible_for_finalization to false."
        }
    }
}

$result = [pscustomobject]@{
    input = (Resolve-Path -LiteralPath $InputPath).Path
    checkedItems = $items.Count
    maxAgeHours = $MaxAgeHours
    validatedAt = $nowValue.ToString("o")
    issueCount = $issues.Count
    issues = @($issues)
}

if ($Format -eq "Json") {
    $result | ConvertTo-Json -Depth 6
}
else {
    "Checked $($result.checkedItems) trend evidence item(s)."
    if ($issues.Count -eq 0) {
        "Trend evidence is valid and fresh."
    }
    else {
        "Found $($issues.Count) trend evidence issue(s):"
        foreach ($issue in $issues) {
            "- [$($issue.rule)] item $($issue.index): $($issue.message)"
        }
    }
}

if ($issues.Count -gt 0) { exit 1 }
exit 0
