#requires -Version 5.1
<#[
Collect genuine installed desktop PowerPoint PNG exports from pinned originals.
Collection is not a comparison verdict or animation/media acceptance.
Run in an interactive Windows desktop with a licensed PowerPoint installation.
]#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$CorpusCache,
 [string[]]$Ids,
 [ValidateRange(1,16384)][int]$Width=960,
 [ValidateRange(0,16384)][int]$Height=0,
 [string]$OutputDirectory=(Join-Path $PSScriptRoot '..\.results\windows-desktop'),
 [string]$NodeExecutable='node'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$output=[IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output)|Out-Null
$report=[ordered]@{schema='microsoft-powerpoint-desktop-static/v1';startedUtc=[DateTime]::UtcNow.ToString('o');
 collectionStatus='unexecuted';acceptanceStatus='unverified';engine='Microsoft PowerPoint desktop COM Slide.Export';
 playbackAcceptance='unverified: static export does not exercise animations, transitions, bookmarks or audio/video';
 requestedWidth=$Width;requestedHeight=$Height;resampling=$false;manualContentReview=$false;files=@();errors=@()}
$exitCode=3;$app=$null;$presentation=$null;$lock=$null
function Save-Report { $report|ConvertTo-Json -Depth 24|Set-Content -LiteralPath (Join-Path $output 'report.json') -Encoding UTF8 }
function Assert-SHA([string]$Path,[string]$Expected){
 if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected){throw "Source changed: $Path"}
}
function Read-PackageXml($Archive,[string]$Name){
 $entry=$Archive.GetEntry($Name);if($null -eq $entry){throw "Missing package part: $Name"}
 $stream=$entry.Open()
 try{
  $settings=New-Object Xml.XmlReaderSettings;$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null
  $reader=[Xml.XmlReader]::Create($stream,$settings)
  try{$doc=New-Object Xml.XmlDocument;$doc.XmlResolver=$null;$doc.Load($reader);return ,$doc}finally{$reader.Dispose()}
 }finally{$stream.Dispose()}
}
function Get-SourceSlides([string]$Path){
 $archive=[IO.Compression.ZipFile]::OpenRead($Path)
 try{
  $doc=Read-PackageXml $archive 'ppt/presentation.xml';$rels=Read-PackageXml $archive 'ppt/_rels/presentation.xml.rels'
  $pns=$doc.DocumentElement.NamespaceURI
  if($pns -notin @('http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main')){throw 'Unknown PresentationML namespace'}
  $rns=if($pns.StartsWith('http://purl.')){'http://purl.oclc.org/ooxml/officeDocument/relationships'}else{'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
  $map=@{}
  foreach($rel in $rels.DocumentElement.ChildNodes){
   if($rel.LocalName -ne 'Relationship'){continue}
   $key=$rel.GetAttribute('Id');if(!$key -or $map.ContainsKey($key)){throw 'Duplicate/empty relationship ID'};$map[$key]=$rel
  }
  $manager=New-Object Xml.XmlNamespaceManager($doc.NameTable);$manager.AddNamespace('p',$pns)
  $result=@();$seen=@{}
  foreach($slide in $doc.SelectNodes('/p:presentation/p:sldIdLst/p:sldId',$manager)){
   $rid=$slide.GetAttribute('id',$rns);$id=$slide.GetAttribute('id');$rel=$map[$rid]
   if(!$rid -or !$id -or $null -eq $rel -or $seen.ContainsKey($id)){throw 'Invalid slide ID/order relationship'};$seen[$id]=$true
   if($rel.GetAttribute('TargetMode') -eq 'External' -or $rel.GetAttribute('Type') -notmatch '/slide$'){throw 'Invalid slide relationship type'}
   $uri=[Uri]::new([Uri]'http://opc.invalid/ppt/presentation.xml',$rel.GetAttribute('Target'))
   $part=[Uri]::UnescapeDataString($uri.AbsolutePath).TrimStart('/')
   if($uri.Host -ne 'opc.invalid' -or $part -notmatch '^ppt/slides/[^/]+\.xml$' -or $uri.Query -or $uri.Fragment){throw 'Unsafe slide target'}
   $slideXml=Read-PackageXml $archive $part
   $result+=@{index=$result.Count+1;slideID=$id;relationshipId=$rid;part=$part;hidden=($slideXml.DocumentElement.GetAttribute('show') -in @('0','false'))}
  }
  if(!$result.Count){throw 'No authored slides'}
  $size=$doc.SelectSingleNode('/p:presentation/p:sldSz',$manager);if($null -eq $size){throw 'Missing slide dimensions'}
  return @{slides=$result;cx=[int64]$size.GetAttribute('cx');cy=[int64]$size.GetAttribute('cy')}
 }finally{$archive.Dispose()}
}
try{
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){$report.errors+= 'Windows desktop/PowerPoint unavailable';Save-Report;exit 3}
 if(![Environment]::UserInteractive){throw 'Interactive Windows desktop required'}
 if([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA'){throw 'Run powershell.exe -STA -File Collect-PowerPointStatic.ps1'}
 if(Get-Process POWERPNT -ErrorAction SilentlyContinue){throw 'Close existing PowerPoint sessions first; collector will not take ownership of user sessions'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 Add-Type -AssemblyName System.Drawing
 $preflightPath=Join-Path $output 'preflight.json'
 $arguments=@((Join-Path $PSScriptRoot 'preflight.cjs'),$preflightPath,[IO.Path]::GetFullPath($CorpusCache))
 if($PSBoundParameters.ContainsKey('Ids')){if(!$Ids.Count -or @($Ids|Where-Object {![string]$_}).Count){throw 'Empty selection'};$arguments+=($Ids -join ',')}
 & $NodeExecutable @arguments
 if($LASTEXITCODE -ne 0){throw 'Pinned SHA/CRC preflight failed; no Office rendering attempted'}
 $corpusFiles=Get-Content -Raw -LiteralPath $preflightPath|ConvertFrom-Json
 if(@($corpusFiles.files).Count -eq 0){throw 'Empty verified selection'}
 $report.manifestPath=$corpusFiles.manifestPath;$report.manifestSha256=$corpusFiles.manifestSha256
 Assert-SHA $corpusFiles.manifestPath $corpusFiles.manifestSha256
 # Resolve all source slide orders before creating a COM application.
 $inventories=@{}
 foreach($corpusFile in $corpusFiles.files){Assert-SHA $corpusFile.path $corpusFile.sha256;$inventory=Get-SourceSlides $corpusFile.path;if($inventory.slides.Count -ne $corpusFile.expectedSlides){throw 'Authored inventory mismatch'};$inventories[$corpusFile.id]=$inventory}
 $app=New-Object -ComObject PowerPoint.Application
 $app.AutomationSecurity=3 # msoAutomationSecurityForceDisable; no macro execution.
 $app.DisplayAlerts=1;$app.Visible=-1
 $process=@(Get-Process POWERPNT);if($process.Count -ne 1){throw 'Cannot establish unique PowerPoint process provenance'}
 $exe=$process[0].Path;$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
 $report.office=@{applicationVersion=[string]$app.Version;fileVersion=$version.FileVersion;productVersion=$version.ProductVersion;companyName=$version.CompanyName;productName=$version.ProductName;executable=$exe;pid=$process[0].Id;executableSHA256=(Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant()}
 $report.environment=@{os=[Environment]::OSVersion.VersionString;powerShellVersion=$PSVersionTable.PSVersion.ToString();culture=[Globalization.CultureInfo]::CurrentCulture.Name;uiCulture=[Globalization.CultureInfo]::CurrentUICulture.Name;interactive=[Environment]::UserInteractive;fonts=@([Drawing.Text.InstalledFontCollection]::new().Families|ForEach-Object {$_.Name}|Sort-Object)}
 foreach($corpusFile in $corpusFiles.files){
  Assert-SHA $corpusFiles.manifestPath $corpusFiles.manifestSha256;Assert-SHA $corpusFile.path $corpusFile.sha256
  # Prevent writes/deletion while PowerPoint opens and exports this original.
  $lock=[IO.File]::Open($corpusFile.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{
   $inventory=$inventories[$corpusFile.id];$destination=Join-Path $output $corpusFile.id
   if(Test-Path -LiteralPath $destination){throw "Refusing stale/overwrite baseline directory: $destination"}
   [IO.Directory]::CreateDirectory($destination)|Out-Null
   $presentation=$app.Presentations.Open($corpusFile.path,-1,0,0) # ReadOnly, not Untitled; original is never saved/repaired.
   if($presentation.ReadOnly -ne -1 -or $presentation.Slides.Count -ne $inventory.slides.Count){throw 'Office read-only/slide-count mismatch'}
   $heightForFile=if($Height){$Height}else{[int][Math]::Round($Width*$inventory.cy/$inventory.cx,[MidpointRounding]::AwayFromZero)}
   if($heightForFile -le 0){throw 'Invalid output height'}
   if($heightForFile -ne [int][Math]::Round($Width*$inventory.cy/$inventory.cx,[MidpointRounding]::AwayFromZero)){throw 'Height must match the original aspect ratio rounded to a native pixel; no image resizing permitted'}
   $entry=[ordered]@{id=$corpusFile.id;sourceSHA256=$corpusFile.sha256;sourceBytes=$corpusFile.sizeBytes;sourceCommit=$corpusFile.sourceCommit;sourceURL=$corpusFile.sourceURL;crcVerified=$corpusFile.integrity.crcVerified;slideOrder=$inventory.slides;slides=@();errors=@();manualContentReview=$false;acceptanceStatus='unverified'}
   foreach($sourceSlide in $inventory.slides){
    $slide=$presentation.Slides.Item($sourceSlide.index)
    try{
     $actualID=[uint32]([int64]$slide.SlideID -band 4294967295)
     if([string]$actualID -ne $sourceSlide.slideID -or $slide.SlideIndex -ne $sourceSlide.index){throw 'PowerPoint slide identity/order differs from pinned XML'}
     if(($slide.SlideShowTransition.Hidden -eq -1) -ne $sourceSlide.hidden){throw 'PowerPoint hidden-slide state differs from pinned XML'}
     $name='slide-{0:D3}.png' -f $sourceSlide.index;$png=Join-Path $destination $name
     $slide.Export($png,'PNG',$Width,$heightForFile)
     if(!(Test-Path -LiteralPath $png)){throw 'PowerPoint produced no PNG'}
     $image=[Drawing.Image]::FromFile($png)
     try{if($image.Width -ne $Width -or $image.Height -ne $heightForFile){throw 'Native export dimensions differ; no resizing permitted'}}finally{$image.Dispose()}
     $entry.slides+=@{index=$sourceSlide.index;slideID=$sourceSlide.slideID;part=$sourceSlide.part;file=$name;pixelWidth=$Width;pixelHeight=$heightForFile;pngSHA256=(Get-FileHash -LiteralPath $png).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $png).Length;captureMethod='PowerPoint desktop Slide.Export PNG';manualContentReview=$false}
    }finally{[Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide)|Out-Null}
   }
   if($entry.slides.Count -ne $corpusFile.expectedSlides){throw 'Missing native exported pages'}
   $presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null
   Assert-SHA $corpusFile.path $corpusFile.sha256
   $entry|ConvertTo-Json -Depth 24|Set-Content -LiteralPath (Join-Path $destination 'provenance.json') -Encoding UTF8
   $report.files+= $entry
  }finally{if($null -ne $presentation){$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null};$lock.Dispose();$lock=$null}
 }
 Assert-SHA $corpusFiles.manifestPath $corpusFiles.manifestSha256
 $report.collectionStatus='collected-static-candidates';$report.finishedUtc=[DateTime]::UtcNow.ToString('o')
}catch{$report.collectionStatus='error';$report.errors+=$_.Exception.Message;$exitCode=2}
finally{
 if($null -ne $lock){$lock.Dispose()}
 if($null -ne $app){$app.Quit();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null}
 Save-Report
}
exit $exitCode # 3 always: collecting genuine pixels does not prove comparison/full acceptance.
