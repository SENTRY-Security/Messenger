import Foundation

/// Resolves which APNs environment the current build's push tokens belong to:
/// `"sandbox"` for development / ad-hoc signed builds, `"production"` for
/// TestFlight / App Store.
///
/// The backend uses this (reported at VoIP-token subscribe time) to route each
/// push to the matching APNs gateway — a development build's token is only valid
/// on the **sandbox** gateway even when the Worker's default `APNS_ENV` is
/// production, so without this a dev build never receives background VoIP pushes.
enum ApnsEnvironment {
    /// Resolved once per process.
    static let current: String = resolve()

    private static func resolve() -> String {
        // App Store / TestFlight builds carry no embedded provisioning profile →
        // production. Development / ad-hoc builds embed one whose entitlements
        // include the `aps-environment` value.
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let raw = String(data: data, encoding: .isoLatin1) else {
            return "production"
        }
        // The profile is a CMS/PKCS#7 blob, but the entitlements plist sits inside
        // as readable text. Read the value following the `aps-environment` key.
        guard let key = raw.range(of: "aps-environment") else { return "production" }
        let tail = raw[key.upperBound...]
        guard let open = tail.range(of: "<string>"),
              let close = tail.range(of: "</string>", range: open.upperBound..<tail.endIndex) else {
            return "production"
        }
        let value = tail[open.upperBound..<close.lowerBound]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value == "development" ? "sandbox" : "production"
    }
}
