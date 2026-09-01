param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [ValidateSet("Text", "Json")]
    [string]$Format = "Text",
    [string]$Now = ([DateTimeOffset]::Now.ToString("o")),
    [ValidateRange(1, 8760)]
    [double]$MaxAgeHours = 168
)

$ErrorActionPreference = "Stop"

$allowedResearchStatuses = @("complete", "blocked-provisional", "not-required-execution-only")
$allowedReferenceUseModes = @("internal-study", "licensed-recreation", "publishable-translation")
$allowedAuthorizationStatuses = @(
    "R0-owned-or-licensed",
    "R1-user-asserted",
    "R2-unknown",
    "R3-restricted"
)
$allowedReferenceLanes = @("long-form", "current-short-form")
$allowedLongFormMedia = @("anime", "film", "tv", "formal-script", "user-provided-long-form")
$allowedShortFormMedia = @("short-video")
$allowedObservedRangeCreationModes = @("human-directed", "ai-generated", "origin-unverified")
$allowedAProvenance = @("watched-and-transcribed", "watched-with-verified-subtitles", "watched-user-provided-media")
$allowedBProvenance = @("official-script", "licensed-script", "reliable-transcript", "reliable-subtitles", "user-provided-script")
$allowedAEvidenceBasis = @("watched-audio", "watched-visual-audio")
$allowedBEvidenceBasis = @("transcript-dialogue", "script-dialogue")
$allowedReuseBoundaries = @(
    "internal-study-high-fidelity-release-held",
    "licensed-recreation-within-permission-scope",
    "publishable-mechanism-only-expression-rebuilt"
)
$allowedListeners = @("self", "group", "audience", "absent-person")
$allowedCriticalSceneReasons = @(
    "opening-conflict",
    "opening-hook",
    "confrontation",
    "relationship-turn",
    "information-reveal",
    "reversal",
    "emotional-rupture",
    "reconciliation",
    "climax",
    "decision",
    "ad-confirmation",
    "brand-human-confirmation",
    "memory-line"
)
$allowedSceneFunctionTypes = @("ordinary-continuation") + $allowedCriticalSceneReasons

$genericClicheKeys = @(
    "这不可能",
    "我不会放过你",
    "你终于来了",
    "一切都结束了",
    "我们一定能做到",
    "命运掌握在自己手中",
    "无论发生什么我都会陪着你",
    "相信自己",
    "只要我们齐心协力",
    "我是不会认输的",
    "该结束了",
    "轮到我了",
    "你根本不懂",
    "为什么会变成这样",
    "规则是用来付代价的",
    "有些声音会替人记得"
)
$genericClichePattern = '^(?:这(?:怎么|绝对)?不可能|我(?:绝|绝对|一定)?不会(?:就(?:这么|这样))?放过你(?:的)?|你(?:可算|终于)来了|一切(?:都)?结束了|我们一定(?:能|可以)做到|命运(?:就)?掌握在(?:我们|你|自己)手中|无论发生什么我(?:都)?会陪着你|只要我们(?:齐心协力|团结一心)|我(?:是)?不会认输的|现在?该结束了|轮到我了|你根本不懂|为什么(?:会)?变成这样)$'
$genericClicheWithVocativePattern = '^(?:这(?:怎么|绝对)?不可能|我(?:绝|绝对|一定)?不会(?:就(?:这么|这样))?放过你(?:的)?|你(?:可算|终于)来了|一切(?:都)?结束了|我们一定(?:能|可以)做到|命运(?:就)?掌握在(?:我们|你|自己)手中|无论发生什么我(?:都)?会陪着你|只要我们(?:齐心协力|团结一心)|我(?:是)?不会认输的|现在?该结束了|轮到我了|你根本不懂|为什么(?:会)?变成这样)[\p{L}\p{N}_-]{1,16}$'
$genericAuditNotePattern = '(?i)(?:(?:本项|该项|此项|这一项)?.{0,12}(?:已|已经)?(?:完成)?(?:检查|核对|审核|验证).{0,20}(?:通过|没有发现(?:任何)?问题|无(?:任何)?问题)|(?:检查|核对|审核|验证)(?:结果)?(?:为|：|:)?(?:通过|正常|无异常|无问题)$|(?:已|已经).{0,16}(?:逐字|认真|完整|全面)?(?:查看|检查|核对|审核|验证).{0,30}(?:正常|通过|可以.{0,8}(?:交付|发布|使用)|没有.{0,8}问题|无.{0,8}问题))'
$criticalSemanticPattern = '(?i)(?:从.{1,80}(?:转为|变为|变成)|揭示|揭露|反转|秘密被|真相|关系破裂|关系和解|开场交锋|首次交锋|高潮决断|广告人物确认|品牌确认|传播记忆句|(?:收回|撤回|拒绝|不再|不肯|停止).{0,40}(?:承诺|圆谎|替|帮|掩护|信任|支持)|(?:要求|让).{0,32}(?:亲口|自己).{0,20}(?:说明|面对|承认|决定)|(?:以后|今后|从现在起?).{0,16}(?:别|不要|不许).{0,20}(?:让我|要我)?.{0,12}(?:替|帮).{0,16}(?:骗|瞒|圆谎|掩护)|(?:读到|看到|看见|听到|听见|收到|发现|得知).{0,50}(?:短信|消息|信件|邮件|秘密|真相|证据)|(?:(?:刚|已经)(?:看见|看到|听见|听到|发现|得知|知道|读过|看过|听过)|(?:读过|看过|听过)).{0,50}(?:短信|消息|秘密|真相|证据)|(?:仍|还|尚|依然).{0,16}(?:蒙在鼓里|不知道|不知情)|(?:刚|已经)(?:看见|看到|听见|听到|发现|得知|知道).{0,80}(?:还不知道|尚不知|并不知道)|(?:还不知道|尚不知|并不知道).{0,80}(?:刚|已经)(?:看见|看到|听见|听到|发现|得知|知道)|relationship\s+(?:turn|shift|break)|information\s+reveal|opening\s+(?:conflict|hook)|reversal|reconciliation|climax|brand\s+confirmation|memory\s+line)'

$genericFieldKeys = @{
    sceneFunction = @("推进剧情", "推动剧情", "表达情绪", "提供信息", "塑造人物", "承上启下", "制造冲突", "对话")
    visibleTask = @("说话", "回应", "交流", "表达", "进行对话", "推动剧情")
    physicalAction = @("说话", "站着", "看着对方", "无动作", "没有动作", "保持不动")
    knowledgeBasis = @("剧情需要", "剧本需要", "作者知道", "观众知道", "全知视角", "大家都知道")
    sceneSpecificAnchor = @("当前场景", "这个场景", "环境", "此处", "现场")
    lineConsequence = @("无变化", "没有变化", "不产生后果", "nothingchanges", "nochange")
}

function Add-Issue {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [Parameter(Mandatory = $true)][string]$Rule,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Path,
        [Parameter(Mandatory = $true)][string]$Message
    )

    [void]$Issues.Add([pscustomobject][ordered]@{
        rule = $Rule
        path = $Path
        message = $Message
    })
}

function Test-JsonObject {
    param($Value)
    return $Value -is [System.Management.Automation.PSCustomObject]
}

function Get-PropertyNames {
    param($Value)
    if (-not (Test-JsonObject -Value $Value)) {
        return @()
    }
    return @($Value.PSObject.Properties.Name)
}

function Get-SemanticText {
    param($Value)

    if ($Value -isnot [string]) {
        return $null
    }

    $normalized = $Value.Normalize([System.Text.NormalizationForm]::FormKC)
    $normalized = [regex]::Replace($normalized, '[\p{Cf}\p{Cc}]', '')
    $normalized = [regex]::Replace($normalized, '[\p{Z}\s]+', ' ')
    return $normalized.Trim()
}

function Get-ComparisonKey {
    param($Value)

    $text = Get-SemanticText -Value $Value
    if ($null -eq $text) {
        return $null
    }
    return ([regex]::Replace($text.ToLowerInvariant(), '[\p{P}\p{S}\p{Z}\s]+', ''))
}

function Test-MeaningfulString {
    param($Value)

    if ($Value -isnot [string]) {
        return $false
    }

    $text = Get-SemanticText -Value $Value
    if ([string]::IsNullOrWhiteSpace($text) -or $text -notmatch '[\p{L}\p{N}]') {
        return $false
    }

    $key = Get-ComparisonKey -Value $text
    return $key -notin @(
        "none", "null", "nil", "na", "tbd", "todo", "unknown", "notapplicable", "ok", "okay",
        "pass", "passed", "yes", "true", "false", "无", "没有", "暂无", "待定", "不适用", "同上",
        "略", "空", "未知", "待补", "待写", "通过", "已通过", "合格"
    )
}

function Test-RequiredTextField {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Field,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [string]$Rule = "invalid-text-field"
    )

    $properties = Get-PropertyNames -Value $Object
    $fieldPath = "$Path.$Field"
    if ($properties -notcontains $Field) {
        Add-Issue -Issues $Issues -Rule $Rule -Path $fieldPath -Message "Missing required JSON string '$Field'."
        return $false
    }
    if ($Object.$Field -isnot [string]) {
        Add-Issue -Issues $Issues -Rule $Rule -Path $fieldPath -Message "'$Field' must be a JSON string, not a coerced scalar, array, or object."
        return $false
    }
    if (-not (Test-MeaningfulString -Value $Object.$Field)) {
        Add-Issue -Issues $Issues -Rule $Rule -Path $fieldPath -Message "'$Field' must remain meaningful after Unicode NFKC normalization and removal of control/format characters; placeholders are not valid."
        return $false
    }
    return $true
}

function Test-RequiredBooleanField {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Field,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [string]$Rule = "invalid-boolean-field"
    )

    $properties = Get-PropertyNames -Value $Object
    $fieldPath = "$Path.$Field"
    if ($properties -notcontains $Field -or $Object.$Field -isnot [bool]) {
        Add-Issue -Issues $Issues -Rule $Rule -Path $fieldPath -Message "'$Field' must be a native JSON boolean. Strings such as 'true' or 'false' are rejected."
        return $false
    }
    return $true
}

function Test-RequiredEnumField {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Field,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Allowed,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [string]$Rule = "invalid-enum-field"
    )

    if (-not (Test-RequiredTextField -Object $Object -Field $Field -Path $Path -Issues $Issues -Rule $Rule)) {
        return $false
    }

    $value = Get-SemanticText -Value $Object.$Field
    if ($value -cnotin $Allowed) {
        Add-Issue -Issues $Issues -Rule $Rule -Path "$Path.$Field" -Message "'$Field' must exactly match one of: $($Allowed -join ', ')."
        return $false
    }
    return $true
}

function Test-NonEmptyStringArray {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Field,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [string]$Rule = "invalid-string-array",
        [switch]$AllowEmpty
    )

    $properties = Get-PropertyNames -Value $Object
    $fieldPath = "$Path.$Field"
    if ($properties -notcontains $Field -or $Object.$Field -isnot [System.Array]) {
        Add-Issue -Issues $Issues -Rule $Rule -Path $fieldPath -Message "'$Field' must be a native JSON array even when it contains one value."
        return $false
    }

    $items = @($Object.$Field)
    if (-not $AllowEmpty -and $items.Count -eq 0) {
        Add-Issue -Issues $Issues -Rule $Rule -Path $fieldPath -Message "'$Field' must contain at least one meaningful string."
        return $false
    }

    $valid = $true
    $seen = @{}
    for ($index = 0; $index -lt $items.Count; $index++) {
        if ($items[$index] -isnot [string] -or -not (Test-MeaningfulString -Value $items[$index])) {
            Add-Issue -Issues $Issues -Rule $Rule -Path "$fieldPath[$index]" -Message "Every '$Field' entry must be a semantically meaningful JSON string."
            $valid = $false
            continue
        }
        $key = Get-ComparisonKey -Value $items[$index]
        if ($seen.ContainsKey($key)) {
            Add-Issue -Issues $Issues -Rule $Rule -Path "$fieldPath[$index]" -Message "'$Field' entries must be unique after Unicode normalization."
            $valid = $false
        }
        else {
            $seen[$key] = $true
        }
    }
    return $valid
}

function Test-IsoTimestamp {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }
    $text = Get-SemanticText -Value $Value
    if ($text -cnotmatch '(?:Z|[+-]\d{2}:\d{2})$') {
        return $false
    }
    $parsed = [DateTimeOffset]::MinValue
    return [DateTimeOffset]::TryParse(
        $text,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind,
        [ref]$parsed
    )
}

function Test-HttpsUrl {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }
    $uri = $null
    if (-not [Uri]::TryCreate((Get-SemanticText -Value $Value), [UriKind]::Absolute, [ref]$uri)) {
        return $false
    }
    return $uri.Scheme -ceq "https" -and -not [string]::IsNullOrWhiteSpace($uri.Host)
}

function Get-CanonicalLocator {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $null
    }

    $text = Get-SemanticText -Value $Value
    $uri = $null
    if ([Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri) -and $uri.Scheme -cin @("http", "https")) {
        $builder = New-Object UriBuilder($uri)
        $builder.Scheme = $builder.Scheme.ToLowerInvariant()
        $builder.Host = $builder.Host.ToLowerInvariant()
        $builder.Fragment = ""
        if (($builder.Scheme -ceq "https" -and $builder.Port -eq 443) -or ($builder.Scheme -ceq "http" -and $builder.Port -eq 80)) {
            $builder.Port = -1
        }

        $keptQueryParts = @()
        $contentIdentityQueryNames = @(
            "v", "id", "video_id", "videoid", "item_id", "itemid", "aweme_id", "awemeid",
            "aid", "bvid", "cid", "ep", "episode", "episode_id"
        )
        foreach ($part in @($builder.Query.TrimStart('?') -split '&' | Where-Object { $_ -ne "" })) {
            $name = ([Uri]::UnescapeDataString(($part -split '=', 2)[0])).ToLowerInvariant()
            if ($name -cnotin $contentIdentityQueryNames) {
                continue
            }
            $keptQueryParts += $part
        }
        $builder.Query = (@($keptQueryParts | Sort-Object) -join '&')
        $path = $builder.Path.TrimEnd('/')
        if ([string]::IsNullOrEmpty($path)) {
            $path = "/"
        }
        $builder.Path = $path
        return $builder.Uri.AbsoluteUri.TrimEnd('/')
    }

    return (Get-ComparisonKey -Value $text)
}

function Test-AObservedDialogueScope {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }
    $text = Get-SemanticText -Value $Value
    $rangeMatch = [regex]::Match($text, '(?<!\d)(?<start>\d{2,3}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)-(?<end>\d{2,3}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)(?!\d)')
    $hasRange = $false
    if ($rangeMatch.Success) {
        $seconds = @()
        foreach ($groupName in @("start", "end")) {
            $parts = $rangeMatch.Groups[$groupName].Value.Split(':')
            $parsedParts = @()
            $validTimecode = $parts.Count -in @(2, 3)
            foreach ($part in $parts) {
                $number = 0.0
                if (-not [double]::TryParse($part, [Globalization.NumberStyles]::AllowDecimalPoint, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -or $number -lt 0) {
                    $validTimecode = $false
                }
                $parsedParts += $number
            }
            if ($validTimecode -and $parsedParts[-1] -lt 60 -and ($parts.Count -eq 2 -or $parsedParts[-2] -lt 60)) {
                if ($parts.Count -eq 2) {
                    $seconds += ($parsedParts[0] * 60 + $parsedParts[1])
                }
                else {
                    $seconds += ($parsedParts[0] * 3600 + $parsedParts[1] * 60 + $parsedParts[2])
                }
            }
        }
        $hasRange = $seconds.Count -eq 2 -and $seconds[1] -gt $seconds[0]
    }
    $audioStates = @([regex]::Matches($text, '(?<![\p{L}\p{N}_])audio=(?:yes|partial|no|unknown)(?![\p{L}\p{N}_])'))
    $hasVerifiedAudio = $audioStates.Count -eq 1 -and $audioStates[0].Value -cin @("audio=yes", "audio=partial")
    return $hasRange -and $hasVerifiedAudio
}

function Test-BObservedDialogueScope {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }
    $text = Get-SemanticText -Value $Value
    return $text -match '(?i)(?:\b(?:page|pages|line|lines|subtitle|subtitles|transcript|script|scene)\b|页|行|字幕|文稿|剧本|场)'
}

function Get-DialogueLineLockKey {
    param($LineCollection)

    if ($LineCollection -isnot [System.Array]) {
        return $null
    }

    $lockedFields = @(
        "id", "speaker", "listener", "text", "speechAct", "sceneFunction",
        "visibleTask", "subtext", "knowledgeBasis", "physicalAction",
        "sceneSpecificAnchor", "lineConsequence"
    )
    $pairs = @()
    foreach ($line in @($LineCollection)) {
        if (-not (Test-JsonObject -Value $line)) {
            return $null
        }
        $properties = Get-PropertyNames -Value $line
        $values = @()
        foreach ($field in $lockedFields) {
            if ($properties -notcontains $field -or $line.$field -isnot [string]) {
                return $null
            }
            $value = Get-SemanticText -Value $line.$field
            if ([string]::IsNullOrWhiteSpace($value)) {
                return $null
            }
            $values += ($field + "=" + $value)
        }
        $pairs += ($values -join [char]0x001F)
    }
    return $pairs -join [char]0x001E
}

function Write-ValidationResult {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [Parameter(Mandatory = $true)][string]$ResolvedInput,
        [Parameter(Mandatory = $true)][ValidateSet("Text", "Json")][string]$OutputFormat
    )

    $issueArray = @($Issues | ForEach-Object { $_ })
    if ($OutputFormat -eq "Json") {
        [pscustomobject][ordered]@{
            valid = $issueArray.Count -eq 0
            inputPath = $ResolvedInput
            issueCount = $issueArray.Count
            issues = $issueArray
        } | ConvertTo-Json -Depth 8
    }
    elseif ($issueArray.Count -eq 0) {
        Write-Output "Dialogue scene validation passed: $ResolvedInput"
    }
    else {
        Write-Output "Dialogue scene validation failed with $($issueArray.Count) issue(s): $ResolvedInput"
        foreach ($issue in $issueArray) {
            Write-Output "[$($issue.rule)] $($issue.path): $($issue.message)"
        }
    }
}

$issues = New-Object System.Collections.ArrayList
$resolvedInput = $InputPath
$data = $null
$nowValue = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    $Now,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$nowValue
)) {
    Add-Issue -Issues $issues -Rule "invalid-now" -Path "" -Message "Now must be an ISO-8601 timestamp."
}

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
    Add-Issue -Issues $issues -Rule "missing-input" -Path "" -Message "Missing dialogue scene file: $InputPath"
}
else {
    $resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
    try {
        $data = Get-Content -LiteralPath $resolvedInput -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        Add-Issue -Issues $issues -Rule "invalid-json" -Path "" -Message "Input is not valid JSON: $($_.Exception.Message)"
    }
}

if ($null -ne $data -and -not (Test-JsonObject -Value $data)) {
    Add-Issue -Issues $issues -Rule "invalid-root-type" -Path "" -Message "The dialogue scene root must be a JSON object."
    $data = [pscustomobject]@{}
}

if ($issues.Count -gt 0 -and $null -eq $data) {
    Write-ValidationResult -Issues $issues -ResolvedInput $resolvedInput -OutputFormat $Format
    exit 1
}

$rootPath = "scene"
$rootProperties = Get-PropertyNames -Value $data

[void](Test-RequiredTextField -Object $data -Field "schemaVersion" -Path $rootPath -Issues $issues -Rule "invalid-schema-version")
if ((Get-PropertyNames -Value $data) -contains "schemaVersion" -and $data.schemaVersion -is [string] -and
    (Get-SemanticText -Value $data.schemaVersion) -cne "1.0") {
    Add-Issue -Issues $issues -Rule "invalid-schema-version" -Path "scene.schemaVersion" -Message "schemaVersion must exactly equal '1.0'."
}
[void](Test-RequiredTextField -Object $data -Field "sceneId" -Path $rootPath -Issues $issues -Rule "invalid-scene-id")

$criticalSceneValid = Test-RequiredBooleanField -Object $data -Field "criticalScene" -Path $rootPath -Issues $issues -Rule "invalid-critical-scene-type"
$researchStatusValid = Test-RequiredEnumField -Object $data -Field "researchStatus" -Path $rootPath -Allowed $allowedResearchStatuses -Issues $issues -Rule "invalid-research-status"
$finalizationHoldValid = Test-RequiredBooleanField -Object $data -Field "finalizationHold" -Path $rootPath -Issues $issues -Rule "invalid-finalization-hold-type"
$modeValid = Test-RequiredEnumField -Object $data -Field "referenceUseMode" -Path $rootPath -Allowed $allowedReferenceUseModes -Issues $issues -Rule "invalid-reference-use-mode"
$authorizationValid = Test-RequiredEnumField -Object $data -Field "authorizationStatus" -Path $rootPath -Allowed $allowedAuthorizationStatuses -Issues $issues -Rule "invalid-authorization-status"
$releaseHoldValid = Test-RequiredBooleanField -Object $data -Field "releaseHold" -Path $rootPath -Issues $issues -Rule "invalid-release-hold-type"
$noteModeValid = Test-RequiredEnumField -Object $data -Field "referenceNoteMode" -Path $rootPath -Allowed @("dialogue-first-short-note") -Issues $issues -Rule "invalid-reference-note-mode"

$criticalSceneReasons = @()
if ($rootProperties -notcontains "criticalSceneReasons" -or $data.criticalSceneReasons -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-critical-scene-reasons-type" -Path "scene.criticalSceneReasons" -Message "criticalSceneReasons must be a native JSON array, including for an ordinary scene."
}
else {
    $criticalSceneReasons = @($data.criticalSceneReasons)
    $seenReasons = @{}
    for ($reasonIndex = 0; $reasonIndex -lt $criticalSceneReasons.Count; $reasonIndex++) {
        $reason = $criticalSceneReasons[$reasonIndex]
        if ($reason -isnot [string] -or -not (Test-MeaningfulString -Value $reason) -or (Get-SemanticText -Value $reason) -cnotin $allowedCriticalSceneReasons) {
            Add-Issue -Issues $issues -Rule "invalid-critical-scene-reason" -Path "scene.criticalSceneReasons[$reasonIndex]" -Message "Critical reasons must exactly match: $($allowedCriticalSceneReasons -join ', ')."
            continue
        }
        $normalizedReason = Get-SemanticText -Value $reason
        if ($seenReasons.ContainsKey($normalizedReason)) {
            Add-Issue -Issues $issues -Rule "duplicate-critical-scene-reason" -Path "scene.criticalSceneReasons[$reasonIndex]" -Message "criticalSceneReasons must be unique."
        }
        else {
            $seenReasons[$normalizedReason] = $true
        }
    }
}

$sceneFunctionTypes = @()
if ($rootProperties -notcontains "sceneFunctionTypes" -or $data.sceneFunctionTypes -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-scene-function-types" -Path "scene.sceneFunctionTypes" -Message "sceneFunctionTypes must be a native JSON array."
}
else {
    $sceneFunctionTypes = @($data.sceneFunctionTypes)
    if ($sceneFunctionTypes.Count -eq 0) {
        Add-Issue -Issues $issues -Rule "invalid-scene-function-types" -Path "scene.sceneFunctionTypes" -Message "sceneFunctionTypes must contain ordinary-continuation or one or more critical scene roles."
    }
    $seenSceneFunctions = @{}
    for ($functionIndex = 0; $functionIndex -lt $sceneFunctionTypes.Count; $functionIndex++) {
        $functionType = $sceneFunctionTypes[$functionIndex]
        if ($functionType -isnot [string] -or -not (Test-MeaningfulString -Value $functionType) -or
            (Get-SemanticText -Value $functionType) -cnotin $allowedSceneFunctionTypes) {
            Add-Issue -Issues $issues -Rule "invalid-scene-function-type" -Path "scene.sceneFunctionTypes[$functionIndex]" -Message "Scene functions must exactly match: $($allowedSceneFunctionTypes -join ', ')."
            continue
        }
        $normalizedFunction = Get-SemanticText -Value $functionType
        if ($seenSceneFunctions.ContainsKey($normalizedFunction)) {
            Add-Issue -Issues $issues -Rule "duplicate-scene-function-type" -Path "scene.sceneFunctionTypes[$functionIndex]" -Message "sceneFunctionTypes must be unique."
        }
        else {
            $seenSceneFunctions[$normalizedFunction] = $true
        }
    }
}

$declaredCriticalFunctions = @($sceneFunctionTypes | Where-Object { $_ -is [string] -and (Get-SemanticText -Value $_) -cin $allowedCriticalSceneReasons } | ForEach-Object { Get-SemanticText -Value $_ })
$declaresOrdinaryFunction = @($sceneFunctionTypes | Where-Object { $_ -is [string] -and (Get-SemanticText -Value $_) -ceq "ordinary-continuation" }).Count -gt 0
if ($declaresOrdinaryFunction -and $sceneFunctionTypes.Count -gt 1) {
    Add-Issue -Issues $issues -Rule "mixed-ordinary-critical-scene-functions" -Path "scene.sceneFunctionTypes" -Message "ordinary-continuation cannot be mixed with critical scene functions."
}

if ($criticalSceneValid) {
    if ($data.criticalScene -and $criticalSceneReasons.Count -eq 0) {
        Add-Issue -Issues $issues -Rule "missing-critical-scene-reason" -Path "scene.criticalSceneReasons" -Message "A critical scene must state at least one structural reason."
    }
    if (-not $data.criticalScene -and $criticalSceneReasons.Count -gt 0) {
        Add-Issue -Issues $issues -Rule "critical-scene-classification-mismatch" -Path "scene.criticalScene" -Message "Opening conflict, reveal, relationship turn, climax, ad confirmation, or memory-line roles require criticalScene=true."
    }
    if ($data.criticalScene -and $declaredCriticalFunctions.Count -eq 0) {
        Add-Issue -Issues $issues -Rule "scene-function-classification-mismatch" -Path "scene.sceneFunctionTypes" -Message "criticalScene=true requires at least one independently declared critical scene function."
    }
    if (-not $data.criticalScene -and (-not $declaresOrdinaryFunction -or $declaredCriticalFunctions.Count -gt 0)) {
        Add-Issue -Issues $issues -Rule "scene-function-classification-mismatch" -Path "scene.sceneFunctionTypes" -Message "criticalScene=false requires sceneFunctionTypes=[ordinary-continuation]."
    }

    $reasonKeys = @($criticalSceneReasons | Where-Object { $_ -is [string] -and (Get-SemanticText -Value $_) -cin $allowedCriticalSceneReasons } | ForEach-Object { Get-SemanticText -Value $_ } | Sort-Object -Unique)
    $functionKeys = @($declaredCriticalFunctions | Sort-Object -Unique)
    if (($reasonKeys -join "|") -cne ($functionKeys -join "|")) {
        Add-Issue -Issues $issues -Rule "critical-reason-function-mismatch" -Path "scene.criticalSceneReasons" -Message "criticalSceneReasons must exactly match independently declared critical sceneFunctionTypes."
    }
}

foreach ($field in @("sceneObjective", "relationshipTurn", "informationState", "physicalContext", "stakes")) {
    [void](Test-RequiredTextField -Object $data -Field $field -Path $rootPath -Issues $issues -Rule "invalid-scene-grounding")
}

$relationshipBeforeValid = Test-RequiredTextField -Object $data -Field "relationshipStateBefore" -Path $rootPath -Issues $issues -Rule "invalid-relationship-state-before"
$relationshipAfterValid = Test-RequiredTextField -Object $data -Field "relationshipStateAfter" -Path $rootPath -Issues $issues -Rule "invalid-relationship-state-after"
$revealedFactsValid = $true
$newlyRevealedFacts = @()
if ($rootProperties -notcontains "newlyRevealedFacts" -or $data.newlyRevealedFacts -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-newly-revealed-facts" -Path "scene.newlyRevealedFacts" -Message "newlyRevealedFacts must be a native JSON array; use [] only when this scene reveals no new fact."
    $revealedFactsValid = $false
}
else {
    $newlyRevealedFacts = @($data.newlyRevealedFacts)
    for ($factIndex = 0; $factIndex -lt $newlyRevealedFacts.Count; $factIndex++) {
        if ($newlyRevealedFacts[$factIndex] -isnot [string] -or -not (Test-MeaningfulString -Value $newlyRevealedFacts[$factIndex])) {
            Add-Issue -Issues $issues -Rule "invalid-newly-revealed-facts" -Path "scene.newlyRevealedFacts[$factIndex]" -Message "Every newly revealed fact must be a meaningful JSON string."
            $revealedFactsValid = $false
        }
    }
}

$derivedRelationshipTurn = $relationshipBeforeValid -and $relationshipAfterValid -and
    (Get-ComparisonKey -Value $data.relationshipStateBefore) -cne (Get-ComparisonKey -Value $data.relationshipStateAfter)
$derivedInformationReveal = $revealedFactsValid -and $newlyRevealedFacts.Count -gt 0
if ($criticalSceneValid) {
    if (($derivedRelationshipTurn -or $derivedInformationReveal) -and -not $data.criticalScene) {
        Add-Issue -Issues $issues -Rule "derived-critical-scene-misclassified" -Path "scene.criticalScene" -Message "A relationship state change or newly revealed fact derives a critical scene and requires criticalScene=true plus the matching dual-source classification."
    }
    if ($derivedRelationshipTurn -and $declaredCriticalFunctions -cnotcontains "relationship-turn") {
        Add-Issue -Issues $issues -Rule "derived-relationship-turn-missing" -Path "scene.sceneFunctionTypes" -Message "Different relationshipStateBefore/After values derive relationship-turn."
    }
    if (-not $derivedRelationshipTurn -and $declaredCriticalFunctions -ccontains "relationship-turn") {
        Add-Issue -Issues $issues -Rule "declared-relationship-turn-not-grounded" -Path "scene.relationshipStateAfter" -Message "A declared relationship-turn requires distinct before and after relationship states."
    }
    if ($derivedInformationReveal -and $declaredCriticalFunctions -cnotcontains "information-reveal") {
        Add-Issue -Issues $issues -Rule "derived-information-reveal-missing" -Path "scene.sceneFunctionTypes" -Message "A non-empty newlyRevealedFacts array derives information-reveal."
    }
    if (-not $derivedInformationReveal -and $declaredCriticalFunctions -ccontains "information-reveal") {
        Add-Issue -Issues $issues -Rule "declared-information-reveal-not-grounded" -Path "scene.newlyRevealedFacts" -Message "A declared information-reveal requires at least one concrete newly revealed fact."
    }
}

if ($researchStatusValid -and $finalizationHoldValid) {
    if ($data.researchStatus -ceq "blocked-provisional") {
        if (-not $data.finalizationHold) {
            Add-Issue -Issues $issues -Rule "provisional-without-finalization-hold" -Path "scene.finalizationHold" -Message "Blocked research may only produce a provisional scene with finalizationHold=true."
        }
        [void](Test-RequiredTextField -Object $data -Field "researchBlocker" -Path $rootPath -Issues $issues -Rule "missing-research-blocker")
        [void](Test-NonEmptyStringArray -Object $data -Field "blockerEvidence" -Path $rootPath -Issues $issues -Rule "missing-blocker-evidence")
        if ($releaseHoldValid -and -not $data.releaseHold) {
            Add-Issue -Issues $issues -Rule "provisional-without-release-hold" -Path "scene.releaseHold" -Message "A blocked provisional dialogue scene must remain releaseHold=true."
        }
    }
    elseif ($data.researchStatus -ceq "complete" -and $data.finalizationHold) {
        Add-Issue -Issues $issues -Rule "complete-research-still-held" -Path "scene.finalizationHold" -Message "Complete dialogue research must use finalizationHold=false; release restrictions belong in releaseHold."
    }
    elseif ($data.researchStatus -ceq "not-required-execution-only") {
        if ($data.finalizationHold) {
            Add-Issue -Issues $issues -Rule "execution-only-finalization-hold" -Path "scene.finalizationHold" -Message "Execution-only work must use finalizationHold=false."
        }
        [void](Test-RequiredEnumField -Object $data -Field "executionKind" -Path $rootPath -Allowed @("timing", "subtitle-format", "lip-sync") -Issues $issues -Rule "invalid-execution-kind")
        $lockedValid = Test-RequiredBooleanField -Object $data -Field "lockedDialogue" -Path $rootPath -Issues $issues -Rule "invalid-locked-dialogue-type"
        $newDialogueValid = Test-RequiredBooleanField -Object $data -Field "newDialogueWritten" -Path $rootPath -Issues $issues -Rule "invalid-new-dialogue-written-type"
        if ($lockedValid -and -not $data.lockedDialogue) {
            Add-Issue -Issues $issues -Rule "execution-only-dialogue-not-locked" -Path "scene.lockedDialogue" -Message "Execution-only bypass requires lockedDialogue=true."
        }
        if ($newDialogueValid -and $data.newDialogueWritten) {
            Add-Issue -Issues $issues -Rule "execution-only-new-writing-forbidden" -Path "scene.newDialogueWritten" -Message "Execution-only mode cannot write or rewrite dialogue."
        }

        $lockedSourceValid = Test-RequiredTextField -Object $data -Field "lockedDialogueSource" -Path $rootPath -Issues $issues -Rule "invalid-locked-dialogue-source"
        $lockedDigestValid = Test-RequiredTextField -Object $data -Field "lockedDialogueSha256" -Path $rootPath -Issues $issues -Rule "invalid-locked-dialogue-digest"
        if ($lockedSourceValid) {
            $lockedSourcePath = Get-SemanticText -Value $data.lockedDialogueSource
            if (-not [System.IO.Path]::IsPathRooted($lockedSourcePath) -or -not (Test-Path -LiteralPath $lockedSourcePath -PathType Leaf)) {
                Add-Issue -Issues $issues -Rule "locked-dialogue-source-not-archived" -Path "scene.lockedDialogueSource" -Message "Execution-only mode requires an existing absolute local JSON snapshot of the approved dialogue."
            }
            else {
                if ($lockedDigestValid) {
                    $declaredLockedDigest = (Get-SemanticText -Value $data.lockedDialogueSha256).ToLowerInvariant()
                    $actualLockedDigest = (Get-FileHash -LiteralPath $lockedSourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
                    if ($declaredLockedDigest -cnotmatch '^[0-9a-f]{64}$' -or $declaredLockedDigest -cne $actualLockedDigest) {
                        Add-Issue -Issues $issues -Rule "locked-dialogue-digest-mismatch" -Path "scene.lockedDialogueSha256" -Message "lockedDialogueSha256 must match the archived approved-dialogue snapshot."
                    }
                }

                try {
                    $lockedDialogueData = Get-Content -LiteralPath $lockedSourcePath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $lockedLineKey = Get-DialogueLineLockKey -LineCollection $lockedDialogueData.lines
                    $currentLineKey = Get-DialogueLineLockKey -LineCollection $data.lines
                    if ($null -eq $lockedLineKey -or $null -eq $currentLineKey -or $lockedLineKey -cne $currentLineKey) {
                        Add-Issue -Issues $issues -Rule "execution-dialogue-does-not-match-lock" -Path "scene.lines" -Message "Execution-only lines must exactly match every approved line field, including speaker, listener, text, function, action, knowledge, anchor, and consequence."
                    }
                }
                catch {
                    Add-Issue -Issues $issues -Rule "invalid-locked-dialogue-snapshot" -Path "scene.lockedDialogueSource" -Message "The approved-dialogue snapshot must be valid JSON with a lines array of id/text pairs."
                }
            }
        }
    }
}

if ($criticalSceneValid -and -not $data.criticalScene) {
    $classificationText = @($data.sceneObjective, $data.relationshipTurn, $data.informationState) |
        ForEach-Object { Get-SemanticText -Value $_ } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $classificationText = $classificationText -join " | "
    if ($classificationText -match $criticalSemanticPattern) {
        Add-Issue -Issues $issues -Rule "scene-function-semantic-mismatch" -Path "scene.sceneFunctionTypes" -Message "The scene grounding text describes a critical function, so it cannot be classified as ordinary-continuation."
    }
}

$expressionBoundary = $null
if ($rootProperties -notcontains "expressionBoundary" -or -not (Test-JsonObject -Value $data.expressionBoundary)) {
    Add-Issue -Issues $issues -Rule "invalid-expression-boundary" -Path "scene.expressionBoundary" -Message "expressionBoundary must be a JSON object."
}
else {
    $expressionBoundary = $data.expressionBoundary
    [void](Test-RequiredBooleanField -Object $expressionBoundary -Field "exactDialogueCopied" -Path "scene.expressionBoundary" -Issues $issues -Rule "invalid-expression-boundary")
    [void](Test-RequiredBooleanField -Object $expressionBoundary -Field "identifiableExpressionRebuilt" -Path "scene.expressionBoundary" -Issues $issues -Rule "invalid-expression-boundary")
    [void](Test-RequiredTextField -Object $expressionBoundary -Field "notes" -Path "scene.expressionBoundary" -Issues $issues -Rule "invalid-expression-boundary")
}

if ($modeValid -and $authorizationValid -and $releaseHoldValid) {
    if ($data.authorizationStatus -ceq "R3-restricted") {
        Add-Issue -Issues $issues -Rule "restricted-reference" -Path "scene.authorizationStatus" -Message "R3-restricted material cannot be used in this dialogue implementation."
    }
    if ($data.referenceUseMode -ceq "internal-study" -and -not $data.releaseHold) {
        Add-Issue -Issues $issues -Rule "internal-study-release-hold" -Path "scene.releaseHold" -Message "internal-study requires releaseHold=true."
    }
    if ($data.referenceUseMode -ceq "licensed-recreation" -and $data.authorizationStatus -cne "R0-owned-or-licensed") {
        Add-Issue -Issues $issues -Rule "licensed-recreation-requires-r0" -Path "scene.authorizationStatus" -Message "licensed-recreation requires verified R0 authorization."
    }
    if ($data.authorizationStatus -ceq "R1-user-asserted" -and $data.referenceUseMode -cne "internal-study") {
        Add-Issue -Issues $issues -Rule "r1-requires-internal-study" -Path "scene.referenceUseMode" -Message "R1 may only advance as internal-study with a release hold while proof is pending."
    }
}

if ($modeValid -and $data.referenceUseMode -ceq "licensed-recreation") {
    if ($rootProperties -notcontains "permissionScope" -or -not (Test-JsonObject -Value $data.permissionScope)) {
        Add-Issue -Issues $issues -Rule "missing-license-permission-scope" -Path "scene.permissionScope" -Message "licensed-recreation requires a verified permissionScope object."
    }
    else {
        $permissionScope = $data.permissionScope
        $coveredElementsValid = Test-NonEmptyStringArray -Object $permissionScope -Field "coveredElements" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-covered-elements"
        [void](Test-NonEmptyStringArray -Object $permissionScope -Field "permittedUses" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-permitted-uses")
        [void](Test-NonEmptyStringArray -Object $permissionScope -Field "territories" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-territories")
        $evidenceLocationValid = Test-RequiredTextField -Object $permissionScope -Field "evidenceLocation" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-evidence-location"
        $evidenceShaValid = Test-RequiredTextField -Object $permissionScope -Field "evidenceSha256" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-evidence-digest"
        [void](Test-RequiredTextField -Object $permissionScope -Field "evidenceVerifiedBy" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-evidence-verifier")
        $evidenceDocumentTypeValid = Test-RequiredEnumField -Object $permissionScope -Field "evidenceDocumentType" -Path "scene.permissionScope" -Allowed @("executed-license", "rights-holder-authorization", "ownership-record") -Issues $issues -Rule "invalid-license-evidence-document-type"
        $evidenceAuthorizationIdValid = Test-RequiredTextField -Object $permissionScope -Field "evidenceAuthorizationId" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-evidence-authorization-id"
        $evidenceIssuerValid = Test-RequiredTextField -Object $permissionScope -Field "evidenceIssuer" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-evidence-issuer"
        $evidenceGranteeValid = Test-RequiredTextField -Object $permissionScope -Field "evidenceGrantee" -Path "scene.permissionScope" -Issues $issues -Rule "invalid-license-evidence-grantee"

        if ($evidenceLocationValid) {
            $evidencePath = Get-SemanticText -Value $permissionScope.evidenceLocation
            if (-not [System.IO.Path]::IsPathRooted($evidencePath) -or -not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) {
                Add-Issue -Issues $issues -Rule "license-evidence-not-archived" -Path "scene.permissionScope.evidenceLocation" -Message "R0 permission evidence must point to an existing absolute local archive file; an assertion or nonexistent path is not verified evidence."
            }
            else {
                $evidenceExtension = [System.IO.Path]::GetExtension($evidencePath).ToLowerInvariant()
                if ($evidenceExtension -cnotin @(".json", ".pdf", ".eml", ".msg")) {
                    Add-Issue -Issues $issues -Rule "unsupported-license-evidence-format" -Path "scene.permissionScope.evidenceLocation" -Message "Permission evidence must be an archived JSON manifest, PDF, EML, or MSG record; an arbitrary project file cannot serve as R0 evidence."
                }

                if ($evidenceShaValid) {
                    $declaredDigest = (Get-SemanticText -Value $permissionScope.evidenceSha256).ToLowerInvariant()
                    if ($declaredDigest -cnotmatch '^[0-9a-f]{64}$') {
                        Add-Issue -Issues $issues -Rule "invalid-license-evidence-digest" -Path "scene.permissionScope.evidenceSha256" -Message "evidenceSha256 must be a lowercase 64-character SHA-256 digest."
                    }
                    else {
                        $actualDigest = (Get-FileHash -LiteralPath $evidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
                        if ($actualDigest -cne $declaredDigest) {
                            Add-Issue -Issues $issues -Rule "license-evidence-digest-mismatch" -Path "scene.permissionScope.evidenceSha256" -Message "The archived R0 permission evidence does not match evidenceSha256."
                        }
                    }
                }

                if ($evidenceExtension -ceq ".json" -and $evidenceDocumentTypeValid -and $evidenceAuthorizationIdValid -and $evidenceIssuerValid -and $evidenceGranteeValid) {
                    try {
                        $evidenceManifest = Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
                        if (-not (Test-JsonObject -Value $evidenceManifest)) {
                            throw "manifest root is not an object"
                        }
                        $manifestProperties = Get-PropertyNames -Value $evidenceManifest
                        if ($manifestProperties -notcontains "schemaVersion" -or $evidenceManifest.schemaVersion -isnot [string] -or
                            (Get-SemanticText -Value $evidenceManifest.schemaVersion) -cne "rights-evidence-1.0") {
                            Add-Issue -Issues $issues -Rule "invalid-license-evidence-manifest" -Path "scene.permissionScope.evidenceLocation" -Message "The authorization manifest must use schemaVersion=rights-evidence-1.0."
                        }
                        $scalarEvidenceMap = [ordered]@{
                            documentType = "evidenceDocumentType"
                            authorizationId = "evidenceAuthorizationId"
                            issuer = "evidenceIssuer"
                            grantee = "evidenceGrantee"
                            validFrom = "validFrom"
                            validUntil = "validUntil"
                        }
                        foreach ($manifestField in $scalarEvidenceMap.Keys) {
                            $scopeField = $scalarEvidenceMap[$manifestField]
                            if ($manifestProperties -notcontains $manifestField -or $evidenceManifest.$manifestField -isnot [string] -or
                                (Get-SemanticText -Value $evidenceManifest.$manifestField) -cne (Get-SemanticText -Value $permissionScope.$scopeField)) {
                                Add-Issue -Issues $issues -Rule "license-evidence-manifest-mismatch" -Path "scene.permissionScope.$scopeField" -Message "The archived authorization manifest '$manifestField' must match permissionScope.$scopeField."
                            }
                        }
                        foreach ($manifestField in @("coveredElements", "permittedUses", "territories")) {
                            if ($manifestProperties -notcontains $manifestField -or $evidenceManifest.$manifestField -isnot [System.Array]) {
                                Add-Issue -Issues $issues -Rule "invalid-license-evidence-manifest" -Path "scene.permissionScope.evidenceLocation" -Message "The archived authorization manifest must contain native arrays for coveredElements, permittedUses, and territories."
                                continue
                            }
                            $manifestValues = @($evidenceManifest.$manifestField | ForEach-Object { Get-ComparisonKey -Value $_ } | Sort-Object -Unique)
                            $scopeValues = @($permissionScope.$manifestField | ForEach-Object { Get-ComparisonKey -Value $_ } | Sort-Object -Unique)
                            if (($manifestValues -join "|") -cne ($scopeValues -join "|")) {
                                Add-Issue -Issues $issues -Rule "license-evidence-manifest-mismatch" -Path "scene.permissionScope.$manifestField" -Message "The archived authorization manifest '$manifestField' must match permissionScope.$manifestField."
                            }
                        }
                    }
                    catch {
                        Add-Issue -Issues $issues -Rule "invalid-license-evidence-manifest" -Path "scene.permissionScope.evidenceLocation" -Message "JSON permission evidence must be a readable structured authorization manifest."
                    }
                }
            }
        }

        $verifiedAtValid = $permissionScope.PSObject.Properties.Name -contains "evidenceVerifiedAt" -and
            $permissionScope.evidenceVerifiedAt -is [string] -and (Test-IsoTimestamp -Value $permissionScope.evidenceVerifiedAt)
        if (-not $verifiedAtValid) {
            Add-Issue -Issues $issues -Rule "invalid-license-evidence-verified-at" -Path "scene.permissionScope.evidenceVerifiedAt" -Message "evidenceVerifiedAt must be an ISO-8601 timestamp with timezone."
        }
        else {
            $evidenceVerifiedAt = [DateTimeOffset]::MinValue
            [void][DateTimeOffset]::TryParse($permissionScope.evidenceVerifiedAt, [ref]$evidenceVerifiedAt)
            if ($evidenceVerifiedAt -gt $nowValue.AddMinutes(5)) {
                Add-Issue -Issues $issues -Rule "future-license-evidence-verification" -Path "scene.permissionScope.evidenceVerifiedAt" -Message "evidenceVerifiedAt cannot be in the future."
            }
        }

        if ($coveredElementsValid) {
            $coveredElementKeys = @($permissionScope.coveredElements | ForEach-Object { Get-SemanticText -Value $_ })
            if ($coveredElementKeys -cnotcontains "dialogue-story") {
                Add-Issue -Issues $issues -Rule "license-does-not-cover-dialogue-story" -Path "scene.permissionScope.coveredElements" -Message "permissionScope.coveredElements must explicitly include 'dialogue-story'."
            }
        }

        $scopeProperties = Get-PropertyNames -Value $permissionScope
        $validFrom = [DateTimeOffset]::MinValue
        $validUntil = [DateTimeOffset]::MinValue
        $validFromOk = $scopeProperties -contains "validFrom" -and $permissionScope.validFrom -is [string] -and (Test-IsoTimestamp -Value $permissionScope.validFrom)
        $validUntilOk = $scopeProperties -contains "validUntil" -and $permissionScope.validUntil -is [string] -and (Test-IsoTimestamp -Value $permissionScope.validUntil)
        if (-not $validFromOk) {
            Add-Issue -Issues $issues -Rule "invalid-license-term" -Path "scene.permissionScope.validFrom" -Message "Permission validFrom must be an ISO-8601 timestamp with timezone."
        }
        else {
            [void][DateTimeOffset]::TryParse($permissionScope.validFrom, [ref]$validFrom)
        }
        if (-not $validUntilOk) {
            Add-Issue -Issues $issues -Rule "invalid-license-term" -Path "scene.permissionScope.validUntil" -Message "Permission validUntil must be an ISO-8601 timestamp with timezone."
        }
        else {
            [void][DateTimeOffset]::TryParse($permissionScope.validUntil, [ref]$validUntil)
        }
        if ($validFromOk -and $validUntilOk) {
            if ($validUntil -le $validFrom) {
                Add-Issue -Issues $issues -Rule "invalid-license-term" -Path "scene.permissionScope" -Message "Permission validUntil must be later than validFrom."
            }
            elseif ($nowValue -lt $validFrom -or $nowValue -gt $validUntil) {
                Add-Issue -Issues $issues -Rule "license-term-not-current" -Path "scene.permissionScope" -Message "The verified permission term does not cover the validation time."
            }
        }
    }
}

if ($modeValid -and $null -ne $expressionBoundary -and $data.referenceUseMode -ceq "publishable-translation") {
    $boundaryProperties = Get-PropertyNames -Value $expressionBoundary
    if ($boundaryProperties -contains "exactDialogueCopied" -and $expressionBoundary.exactDialogueCopied -is [bool] -and $expressionBoundary.exactDialogueCopied) {
        Add-Issue -Issues $issues -Rule "publishable-translation-copies-dialogue" -Path "scene.expressionBoundary.exactDialogueCopied" -Message "publishable-translation must not copy exact dialogue."
    }
    if ($boundaryProperties -contains "identifiableExpressionRebuilt" -and $expressionBoundary.identifiableExpressionRebuilt -is [bool] -and -not $expressionBoundary.identifiableExpressionRebuilt) {
        Add-Issue -Issues $issues -Rule "publishable-translation-not-rebuilt" -Path "scene.expressionBoundary.identifiableExpressionRebuilt" -Message "publishable-translation must rebuild identifiable dialogue expression."
    }
}

$characterIds = @{}
$charactersById = @{}
$characters = @()
if ($rootProperties -notcontains "characters" -or $data.characters -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-characters-type" -Path "scene.characters" -Message "characters must be a native JSON array."
}
else {
    $characters = @($data.characters)
    if ($characters.Count -eq 0) {
        Add-Issue -Issues $issues -Rule "missing-characters" -Path "scene.characters" -Message "At least one character voice card is required."
    }
}

for ($index = 0; $index -lt $characters.Count; $index++) {
    $character = $characters[$index]
    $path = "scene.characters[$index]"
    if (-not (Test-JsonObject -Value $character)) {
        Add-Issue -Issues $issues -Rule "invalid-character-type" -Path $path -Message "Every character entry must be a JSON object."
        continue
    }

    $idValid = Test-RequiredTextField -Object $character -Field "id" -Path $path -Issues $issues -Rule "invalid-character-id"
    foreach ($field in @("name", "lifeStage", "socialRole", "relationshipPosition", "sentenceShape", "addressSystem", "pressureMutation")) {
        [void](Test-RequiredTextField -Object $character -Field $field -Path $path -Issues $issues -Rule "invalid-character-voice-field")
    }
    [void](Test-RequiredTextField -Object $character -Field "knowledgeBoundary" -Path $path -Issues $issues -Rule "missing-character-knowledge-boundary")
    [void](Test-RequiredTextField -Object $character -Field "register" -Path $path -Issues $issues -Rule "missing-character-register")
    [void](Test-RequiredTextField -Object $character -Field "defenseStrategy" -Path $path -Issues $issues -Rule "missing-character-defense-strategy")
    [void](Test-NonEmptyStringArray -Object $character -Field "actionVerbs" -Path $path -Issues $issues -Rule "invalid-character-action-verbs")
    [void](Test-NonEmptyStringArray -Object $character -Field "neverSays" -Path $path -Issues $issues -Rule "invalid-character-never-says")

    $characterProperties = Get-PropertyNames -Value $character
    if ($characterProperties -notcontains "echoBudget" -or $character.echoBudget -is [bool] -or
        $character.echoBudget -isnot [ValueType] -or [double]$character.echoBudget -ne [math]::Floor([double]$character.echoBudget) -or
        [double]$character.echoBudget -lt 0 -or [double]$character.echoBudget -gt 3) {
        Add-Issue -Issues $issues -Rule "invalid-character-echo-budget" -Path "$path.echoBudget" -Message "echoBudget must be a native JSON integer from 0 through 3."
    }

    if ($idValid) {
        $id = Get-SemanticText -Value $character.id
        if ($characterIds.ContainsKey($id)) {
            Add-Issue -Issues $issues -Rule "duplicate-character-id" -Path "$path.id" -Message "Character ids must be unique after Unicode normalization."
        }
        else {
            $characterIds[$id] = $true
            $charactersById[$id] = $character
        }
    }
}

$referenceSet = @()
if ($rootProperties -notcontains "referenceSet" -or $data.referenceSet -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-reference-set-type" -Path "scene.referenceSet" -Message "referenceSet must be a native JSON array, including when empty."
}
else {
    $referenceSet = @($data.referenceSet)
}

$referenceIds = @{}
$referenceLocators = @{}
$validLongFormCount = 0
$validShortFormCount = 0
for ($index = 0; $index -lt $referenceSet.Count; $index++) {
    $reference = $referenceSet[$index]
    $path = "scene.referenceSet[$index]"
    if (-not (Test-JsonObject -Value $reference)) {
        Add-Issue -Issues $issues -Rule "invalid-reference-entry" -Path $path -Message "Every referenceSet entry must be a JSON object."
        continue
    }

    $sourceEligible = $true
    $sourceIdValid = Test-RequiredTextField -Object $reference -Field "sourceId" -Path $path -Issues $issues -Rule "invalid-reference-source-id"
    foreach ($field in @("title", "platform", "sourceLocator", "observedScope", "originEvidence")) {
        if (-not (Test-RequiredTextField -Object $reference -Field $field -Path $path -Issues $issues -Rule "invalid-reference-field")) {
            $sourceEligible = $false
        }
    }
    $laneValid = Test-RequiredEnumField -Object $reference -Field "lane" -Path $path -Allowed $allowedReferenceLanes -Issues $issues -Rule "invalid-reference-lane"
    $levelValid = Test-RequiredEnumField -Object $reference -Field "evidenceLevel" -Path $path -Allowed @("A", "B") -Issues $issues -Rule "invalid-evidence-level"
    $referenceModeValid = Test-RequiredEnumField -Object $reference -Field "referenceUseMode" -Path $path -Allowed $allowedReferenceUseModes -Issues $issues -Rule "invalid-reference-use-mode"
    $referenceAuthorizationValid = Test-RequiredEnumField -Object $reference -Field "authorizationStatus" -Path $path -Allowed $allowedAuthorizationStatuses -Issues $issues -Rule "invalid-authorization-status"
    $reuseBoundaryValid = Test-RequiredEnumField -Object $reference -Field "reuseBoundary" -Path $path -Allowed $allowedReuseBoundaries -Issues $issues -Rule "invalid-reuse-boundary"
    if (-not $laneValid -or -not $levelValid -or -not $referenceModeValid -or -not $referenceAuthorizationValid) {
        $sourceEligible = $false
    }
    if (-not $reuseBoundaryValid) {
        $sourceEligible = $false
    }
    $creationModeValid = Test-RequiredEnumField -Object $reference -Field "observedRangeCreationMode" -Path $path -Allowed $allowedObservedRangeCreationModes -Issues $issues -Rule "invalid-reference-creation-mode"
    if (-not $creationModeValid) {
        $sourceEligible = $false
    }
    elseif ($reference.observedRangeCreationMode -ceq "ai-generated") {
        Add-Issue -Issues $issues -Rule "ai-generated-creative-reference-forbidden" -Path "$path.observedRangeCreationMode" -Message "AI-generated dialogue or story samples belong in generationBenchmarkSet and cannot support creative scene writing."
        $sourceEligible = $false
    }
    elseif ($reference.observedRangeCreationMode -ceq "origin-unverified") {
        Add-Issue -Issues $issues -Rule "unverified-reference-origin" -Path "$path.observedRangeCreationMode" -Message "Unknown creation origin cannot support dialogue, scene, performance, or story reference."
        $sourceEligible = $false
    }
    if (-not (Test-NonEmptyStringArray -Object $reference -Field "learnedMechanisms" -Path $path -Issues $issues -Rule "invalid-learned-mechanisms")) {
        $sourceEligible = $false
    }
    if (-not (Test-NonEmptyStringArray -Object $reference -Field "doNotCopy" -Path $path -Issues $issues -Rule "invalid-do-not-copy-boundary")) {
        $sourceEligible = $false
    }

    if ($sourceIdValid) {
        $sourceId = Get-SemanticText -Value $reference.sourceId
        if ($referenceIds.ContainsKey($sourceId)) {
            Add-Issue -Issues $issues -Rule "duplicate-reference-source-id" -Path "$path.sourceId" -Message "Reference source ids must be unique after Unicode normalization."
            $sourceEligible = $false
        }
        else {
            $referenceIds[$sourceId] = $true
        }
    }

    $referenceProperties = Get-PropertyNames -Value $reference
    if ($referenceProperties -contains "sourceLocator" -and $reference.sourceLocator -is [string] -and (Test-MeaningfulString -Value $reference.sourceLocator)) {
        $canonicalLocator = Get-CanonicalLocator -Value $reference.sourceLocator
        if ($null -ne $canonicalLocator) {
            if ($referenceLocators.ContainsKey($canonicalLocator)) {
                Add-Issue -Issues $issues -Rule "duplicate-reference-locator" -Path "$path.sourceLocator" -Message "The same normalized source locator cannot impersonate both research lanes or multiple independent sources."
                $sourceEligible = $false
            }
            else {
                $referenceLocators[$canonicalLocator] = $path
            }
        }
    }

    if ($laneValid) {
        $mediaAllowed = if ($reference.lane -ceq "long-form") { $allowedLongFormMedia } else { $allowedShortFormMedia }
        if (-not (Test-RequiredEnumField -Object $reference -Field "medium" -Path $path -Allowed $mediaAllowed -Issues $issues -Rule "invalid-reference-medium")) {
            $sourceEligible = $false
        }
        if ($reference.lane -ceq "current-short-form") {
            $selectionBasisValid = Test-RequiredEnumField -Object $reference -Field "selectionBasis" -Path $path -Allowed @("viral", "quality") -Issues $issues -Rule "invalid-current-reference-selection-basis"
            if (-not $selectionBasisValid) {
                $sourceEligible = $false
            }
            if (-not (Test-RequiredTextField -Object $reference -Field "currentRelevanceEvidence" -Path $path -Issues $issues -Rule "missing-current-relevance-evidence")) {
                $sourceEligible = $false
            }
            if ($selectionBasisValid -and $reference.selectionBasis -ceq "viral" -and
                -not (Test-RequiredTextField -Object $reference -Field "rankOrHeat" -Path $path -Issues $issues -Rule "missing-current-rank-or-heat")) {
                $sourceEligible = $false
            }
            if ($selectionBasisValid -and $reference.selectionBasis -ceq "quality" -and
                -not (Test-RequiredTextField -Object $reference -Field "qualityRationale" -Path $path -Issues $issues -Rule "missing-current-quality-rationale")) {
                $sourceEligible = $false
            }
            if ($referenceProperties -notcontains "publishedAt" -or $reference.publishedAt -isnot [string] -or -not (Test-IsoTimestamp -Value $reference.publishedAt)) {
                Add-Issue -Issues $issues -Rule "invalid-current-reference-published-at" -Path "$path.publishedAt" -Message "Current short-form references require an ISO-8601 publishedAt timestamp with an explicit timezone."
                $sourceEligible = $false
            }
            else {
                $publishedAt = [DateTimeOffset]::MinValue
                [void][DateTimeOffset]::TryParse($reference.publishedAt, [ref]$publishedAt)
                if ($publishedAt -gt $nowValue.AddMinutes(5)) {
                    Add-Issue -Issues $issues -Rule "future-current-reference-publication" -Path "$path.publishedAt" -Message "publishedAt cannot be in the future relative to Now."
                    $sourceEligible = $false
                }
            }
            if ($referenceProperties -notcontains "capturedAt" -or $reference.capturedAt -isnot [string] -or -not (Test-IsoTimestamp -Value $reference.capturedAt)) {
                Add-Issue -Issues $issues -Rule "invalid-current-reference-captured-at" -Path "$path.capturedAt" -Message "Current short-form references require an ISO-8601 capturedAt timestamp with an explicit timezone."
                $sourceEligible = $false
            }
            else {
                $capturedAt = [DateTimeOffset]::MinValue
                [void][DateTimeOffset]::TryParse($reference.capturedAt, [ref]$capturedAt)
                $ageHours = ($nowValue - $capturedAt).TotalHours
                if ($ageHours -lt -0.0834) {
                    Add-Issue -Issues $issues -Rule "future-current-reference" -Path "$path.capturedAt" -Message "capturedAt cannot be in the future relative to Now."
                    $sourceEligible = $false
                }
                elseif ($ageHours -gt $MaxAgeHours) {
                    Add-Issue -Issues $issues -Rule "stale-current-reference" -Path "$path.capturedAt" -Message "Current short-form evidence is older than MaxAgeHours=$MaxAgeHours."
                    $sourceEligible = $false
                }
            }
            if ($referenceProperties -contains "sourceLocator" -and -not (Test-HttpsUrl -Value $reference.sourceLocator)) {
                Add-Issue -Issues $issues -Rule "invalid-current-reference-url" -Path "$path.sourceLocator" -Message "Current short-form references require an absolute HTTPS source URL."
                $sourceEligible = $false
            }
        }
    }

    if ($levelValid) {
        $provenanceAllowed = if ($reference.evidenceLevel -ceq "A") { $allowedAProvenance } else { $allowedBProvenance }
        if (-not (Test-RequiredEnumField -Object $reference -Field "transcriptProvenance" -Path $path -Allowed $provenanceAllowed -Issues $issues -Rule "invalid-transcript-provenance")) {
            $sourceEligible = $false
        }
        $evidenceBasisAllowed = if ($reference.evidenceLevel -ceq "A") { $allowedAEvidenceBasis } else { $allowedBEvidenceBasis }
        if (-not (Test-RequiredEnumField -Object $reference -Field "mechanismEvidenceBasis" -Path $path -Allowed $evidenceBasisAllowed -Issues $issues -Rule "invalid-dialogue-evidence-basis")) {
            $sourceEligible = $false
        }

        if ($referenceProperties -contains "observedScope" -and $reference.observedScope -is [string]) {
            if ($reference.evidenceLevel -ceq "A" -and -not (Test-AObservedDialogueScope -Value $reference.observedScope)) {
                Add-Issue -Issues $issues -Rule "a-dialogue-scope-requires-verified-audio" -Path "$path.observedScope" -Message "A-level dialogue learning requires an exact watched time range and one audio=yes|partial verification state."
                $sourceEligible = $false
            }
            elseif ($reference.evidenceLevel -ceq "B" -and -not (Test-BObservedDialogueScope -Value $reference.observedScope)) {
                Add-Issue -Issues $issues -Rule "b-dialogue-scope-requires-transcript-range" -Path "$path.observedScope" -Message "B-level dialogue learning must identify a script, transcript, subtitle, page, line, or scene range."
                $sourceEligible = $false
            }
        }
    }

    if ($referenceModeValid -and $modeValid -and $reference.referenceUseMode -cne $data.referenceUseMode) {
        Add-Issue -Issues $issues -Rule "reference-mode-mismatch" -Path "$path.referenceUseMode" -Message "Every reference entry must use the scene's referenceUseMode."
        $sourceEligible = $false
    }
    if ($referenceModeValid -and $reuseBoundaryValid) {
        $expectedReuseBoundary = switch -CaseSensitive ($reference.referenceUseMode) {
            "internal-study" { "internal-study-high-fidelity-release-held" }
            "licensed-recreation" { "licensed-recreation-within-permission-scope" }
            "publishable-translation" { "publishable-mechanism-only-expression-rebuilt" }
        }
        if ($reference.reuseBoundary -cne $expectedReuseBoundary) {
            Add-Issue -Issues $issues -Rule "reuse-boundary-mode-mismatch" -Path "$path.reuseBoundary" -Message "reuseBoundary must match the selected referenceUseMode."
            $sourceEligible = $false
        }
    }
    if ($referenceAuthorizationValid) {
        if ($reference.authorizationStatus -ceq "R3-restricted") {
            Add-Issue -Issues $issues -Rule "restricted-reference" -Path "$path.authorizationStatus" -Message "R3-restricted material cannot support dialogue writing."
            $sourceEligible = $false
        }
        if ($modeValid -and $data.referenceUseMode -ceq "licensed-recreation" -and $reference.authorizationStatus -cne "R0-owned-or-licensed") {
            Add-Issue -Issues $issues -Rule "licensed-recreation-requires-r0" -Path "$path.authorizationStatus" -Message "Every copied reference element in licensed-recreation requires R0."
            $sourceEligible = $false
        }
        if ($modeValid -and $reference.authorizationStatus -ceq "R1-user-asserted" -and $data.referenceUseMode -cne "internal-study") {
            Add-Issue -Issues $issues -Rule "r1-requires-internal-study" -Path "$path.authorizationStatus" -Message "An R1 reference may only be used in internal-study."
            $sourceEligible = $false
        }
    }

    if ($sourceEligible -and $laneValid) {
        if ($reference.lane -ceq "long-form") {
            $validLongFormCount++
        }
        elseif ($reference.lane -ceq "current-short-form") {
            $validShortFormCount++
        }
    }
}

if ($researchStatusValid -and $data.researchStatus -ceq "not-required-execution-only" -and $referenceSet.Count -gt 0) {
    Add-Issue -Issues $issues -Rule "execution-only-reference-set-not-empty" -Path "scene.referenceSet" -Message "Execution-only work uses the locked dialogue and must not claim fresh creative reference research."
}

if ($criticalSceneValid -and $data.criticalScene -and $researchStatusValid) {
    if ($data.researchStatus -ceq "complete") {
        if ($validLongFormCount -lt 1) {
            Add-Issue -Issues $issues -Rule "missing-long-form-reference" -Path "scene.referenceSet" -Message "A complete critical dialogue scene requires at least one A/B long-form anime, film, TV, or script reference."
        }
        if ($validShortFormCount -lt 1) {
            Add-Issue -Issues $issues -Rule "missing-current-short-form-reference" -Path "scene.referenceSet" -Message "A complete critical dialogue scene requires at least one current A/B short-video reference."
        }
    }
    elseif ($data.researchStatus -ceq "blocked-provisional" -and $validLongFormCount -gt 0 -and $validShortFormCount -gt 0) {
        Add-Issue -Issues $issues -Rule "unnecessary-provisional-status" -Path "scene.researchStatus" -Message "Both required source lanes are valid; use researchStatus=complete or state the actual invalid/missing lane."
    }
}
elseif ($criticalSceneValid -and -not $data.criticalScene -and $researchStatusValid -and
    $data.researchStatus -ceq "complete" -and ($validLongFormCount + $validShortFormCount) -lt 1) {
    Add-Issue -Issues $issues -Rule "missing-dialogue-reference" -Path "scene.referenceSet" -Message "New non-critical dialogue still requires at least one relevant A/B long-form or current short-form reference; only locked execution may use an empty referenceSet."
}

$lines = @()
if ($rootProperties -notcontains "lines" -or $data.lines -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-lines-type" -Path "scene.lines" -Message "lines must be a native JSON array."
}
else {
    $lines = @($data.lines)
    if ($lines.Count -eq 0) {
        Add-Issue -Issues $issues -Rule "missing-dialogue-lines" -Path "scene.lines" -Message "At least one dialogue line is required."
    }
}

$lineIds = @{}
for ($index = 0; $index -lt $lines.Count; $index++) {
    $line = $lines[$index]
    $path = "scene.lines[$index]"
    if (-not (Test-JsonObject -Value $line)) {
        Add-Issue -Issues $issues -Rule "invalid-line-type" -Path $path -Message "Every lines entry must be a JSON object."
        continue
    }

    $lineIdValid = Test-RequiredTextField -Object $line -Field "id" -Path $path -Issues $issues -Rule "invalid-line-id"
    $speakerValid = Test-RequiredTextField -Object $line -Field "speaker" -Path $path -Issues $issues -Rule "invalid-line-speaker"
    $listenerValid = Test-RequiredTextField -Object $line -Field "listener" -Path $path -Issues $issues -Rule "invalid-line-listener"
    $textValid = Test-RequiredTextField -Object $line -Field "text" -Path $path -Issues $issues -Rule "invalid-line-text"
    [void](Test-RequiredTextField -Object $line -Field "speechAct" -Path $path -Issues $issues -Rule "invalid-line-speech-act")
    [void](Test-RequiredTextField -Object $line -Field "sceneFunction" -Path $path -Issues $issues -Rule "missing-line-scene-function")
    [void](Test-RequiredTextField -Object $line -Field "visibleTask" -Path $path -Issues $issues -Rule "missing-line-visible-task")
    [void](Test-RequiredTextField -Object $line -Field "subtext" -Path $path -Issues $issues -Rule "missing-line-subtext")
    [void](Test-RequiredTextField -Object $line -Field "knowledgeBasis" -Path $path -Issues $issues -Rule "missing-line-knowledge-basis")
    [void](Test-RequiredTextField -Object $line -Field "physicalAction" -Path $path -Issues $issues -Rule "missing-line-physical-action")
    [void](Test-RequiredTextField -Object $line -Field "sceneSpecificAnchor" -Path $path -Issues $issues -Rule "missing-line-scene-anchor")
    [void](Test-RequiredTextField -Object $line -Field "lineConsequence" -Path $path -Issues $issues -Rule "missing-line-consequence")

    if ($lineIdValid) {
        $lineId = Get-SemanticText -Value $line.id
        if ($lineIds.ContainsKey($lineId)) {
            Add-Issue -Issues $issues -Rule "duplicate-line-id" -Path "$path.id" -Message "Dialogue line ids must be unique after Unicode normalization."
        }
        else {
            $lineIds[$lineId] = $true
        }
    }

    $speakerId = $null
    if ($speakerValid) {
        $speakerId = Get-SemanticText -Value $line.speaker
        if (-not $characterIds.ContainsKey($speakerId)) {
            Add-Issue -Issues $issues -Rule "unknown-line-speaker" -Path "$path.speaker" -Message "speaker must reference a declared character id."
        }
    }
    if ($listenerValid) {
        $listenerId = Get-SemanticText -Value $line.listener
        if (-not $characterIds.ContainsKey($listenerId) -and $listenerId -cnotin $allowedListeners) {
            Add-Issue -Issues $issues -Rule "unknown-line-listener" -Path "$path.listener" -Message "listener must reference a declared character id or one of: $($allowedListeners -join ', ')."
        }
    }

    if ($textValid) {
        $lineKey = Get-ComparisonKey -Value $line.text
        if ($lineKey -cin $genericClicheKeys -or $lineKey -cmatch $genericClichePattern -or $lineKey -cmatch $genericClicheWithVocativePattern) {
            Add-Issue -Issues $issues -Rule "generic-ai-cliche" -Path "$path.text" -Message "This stock line is rejected unless it is rewritten around a concrete scene fact, relationship tactic, or immediate action consequence."
        }
        if ($null -ne $speakerId -and $charactersById.ContainsKey($speakerId)) {
            $speaker = $charactersById[$speakerId]
            if ((Get-PropertyNames -Value $speaker) -contains "neverSays" -and $speaker.neverSays -is [System.Array]) {
                $neverKeys = @($speaker.neverSays | ForEach-Object { Get-ComparisonKey -Value $_ })
                if ($lineKey -cin $neverKeys) {
                    Add-Issue -Issues $issues -Rule "character-never-says-violation" -Path "$path.text" -Message "The line exactly violates the speaker's neverSays boundary."
                }
            }
        }
    }

    foreach ($field in $genericFieldKeys.Keys) {
        $lineProperties = Get-PropertyNames -Value $line
        if ($lineProperties -contains $field -and $line.$field -is [string] -and (Test-MeaningfulString -Value $line.$field)) {
            $fieldKey = Get-ComparisonKey -Value $line.$field
            if ($fieldKey -cin $genericFieldKeys[$field]) {
                Add-Issue -Issues $issues -Rule "generic-line-$($field.ToLowerInvariant())" -Path "$path.$field" -Message "'$field' must name a scene-specific function, action, knowledge source, anchor, or consequence rather than a generic label."
            }
        }
    }
}

if ($criticalSceneValid -and -not $data.criticalScene) {
    $lineClassificationText = @(
        $lines | ForEach-Object {
            if (Test-JsonObject -Value $_) {
                foreach ($field in @("text", "speechAct", "sceneFunction", "subtext", "knowledgeBasis", "lineConsequence")) {
                    if ((Get-PropertyNames -Value $_) -contains $field -and $_.$field -is [string]) {
                        Get-SemanticText -Value $_.$field
                    }
                }
            }
        }
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if (($lineClassificationText -join " | ") -match $criticalSemanticPattern) {
        Add-Issue -Issues $issues -Rule "scene-function-semantic-mismatch" -Path "scene.lines" -Message "Dialogue lines describe a relationship turn or information reveal, so the scene cannot be classified as ordinary-continuation."
    }
}

$auditDefinitions = @(
    [pscustomobject]@{ Boolean = "speakerSwapPassed"; Note = "speakerSwapNote"; Rule = "speaker-swap-audit-failed" },
    [pscustomobject]@{ Boolean = "sharedKnowledgeExpositionPassed"; Note = "sharedKnowledgeExpositionNote"; Rule = "shared-knowledge-exposition-audit-failed" },
    [pscustomobject]@{ Boolean = "sceneDependencyPassed"; Note = "sceneDependencyNote"; Rule = "scene-dependency-audit-failed" },
    [pscustomobject]@{ Boolean = "readAloudPassed"; Note = "readAloudNote"; Rule = "read-aloud-audit-failed" },
    [pscustomobject]@{ Boolean = "rightsBoundaryPassed"; Note = "rightsBoundaryNote"; Rule = "rights-boundary-audit-failed" }
)

if ($rootProperties -notcontains "audits" -or -not (Test-JsonObject -Value $data.audits)) {
    Add-Issue -Issues $issues -Rule "invalid-dialogue-audits" -Path "scene.audits" -Message "audits must be a JSON object with native booleans and evidence notes."
}
else {
    foreach ($definition in $auditDefinitions) {
        $booleanValid = Test-RequiredBooleanField -Object $data.audits -Field $definition.Boolean -Path "scene.audits" -Issues $issues -Rule $definition.Rule
        if ($booleanValid -and -not $data.audits.($definition.Boolean)) {
            Add-Issue -Issues $issues -Rule $definition.Rule -Path "scene.audits.$($definition.Boolean)" -Message "Dialogue finalization requires $($definition.Boolean)=true."
        }
        $noteValid = Test-RequiredTextField -Object $data.audits -Field $definition.Note -Path "scene.audits" -Issues $issues -Rule $definition.Rule
        if ($noteValid) {
            $noteText = Get-SemanticText -Value $data.audits.($definition.Note)
            if ($noteText.Length -lt 12) {
                Add-Issue -Issues $issues -Rule $definition.Rule -Path "scene.audits.$($definition.Note)" -Message "Audit evidence notes must be concrete, not a bare pass label."
            }
            if ($noteText -match $genericAuditNotePattern) {
                Add-Issue -Issues $issues -Rule $definition.Rule -Path "scene.audits.$($definition.Note)" -Message "Audit notes must state the concrete line-level comparison or observation; a long pass statement is not evidence."
            }
            $hasLineIdAnchor = $false
            foreach ($lineId in @($lineIds.Keys)) {
                if ($noteText.IndexOf([string]$lineId, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    $hasLineIdAnchor = $true
                    break
                }
            }
            if (-not $hasLineIdAnchor) {
                Add-Issue -Issues $issues -Rule $definition.Rule -Path "scene.audits.$($definition.Note)" -Message "Every audit note must cite at least one declared dialogue line id so a generic project-level pass statement cannot stand in for line review."
            }
            if ($definition.Boolean -ceq "speakerSwapPassed") {
                $hasSpeakerAnchor = $false
                foreach ($character in $characters) {
                    if (-not (Test-JsonObject -Value $character)) {
                        continue
                    }
                    foreach ($anchorField in @("id", "name")) {
                        if ((Get-PropertyNames -Value $character) -contains $anchorField -and $character.$anchorField -is [string] -and
                            $noteText.IndexOf((Get-SemanticText -Value $character.$anchorField), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                            $hasSpeakerAnchor = $true
                        }
                    }
                }
                if (-not $hasSpeakerAnchor) {
                    Add-Issue -Issues $issues -Rule "speaker-swap-note-missing-character-anchor" -Path "scene.audits.$($definition.Note)" -Message "speakerSwapNote must identify at least one declared character id or name."
                }
            }
        }
    }
}

Write-ValidationResult -Issues $issues -ResolvedInput $resolvedInput -OutputFormat $Format
if ($issues.Count -gt 0) {
    exit 1
}
exit 0
