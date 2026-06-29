import Foundation

/// Validates an NTAG424 SDM tag-wake URL with the backend **before** the web
/// login is loaded. Verification is CMAC-only and non-consuming (`/sdm/verify`
/// does not advance the tag counter), so the web layer's subsequent real
/// `/sdm/exchange` still works.
enum SdmValidator {

    /// SDM params extracted from a tag URL (mirrors web `parseSdmParams`).
    struct Params { let uid: String; let mac: String; let ctr: String }

    /// Parse uid / sdmmac / sdmcounter from the URL query, or nil if absent.
    static func params(from url: URL) -> Params? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = comps.queryItems else { return nil }
        func val(_ names: [String]) -> String? {
            for n in names { if let v = items.first(where: { $0.name.lowercased() == n })?.value, !v.isEmpty { return v } }
            return nil
        }
        let uid = (val(["uid"]) ?? "").filter { $0.isHexDigit }.uppercased()
        let mac = (val(["sdmmac", "mac"]) ?? "").filter { $0.isHexDigit }.uppercased()
        let ctr = val(["sdmcounter", "ctr"]) ?? ""
        guard uid.count >= 14, mac.count >= 16, !ctr.isEmpty else { return nil }
        return Params(uid: uid, mac: mac, ctr: ctr)
    }

    /// True if the URL carries SDM login params (vs plain in-app navigation).
    static func hasSdmParams(_ url: URL) -> Bool { params(from: url) != nil }

    /// Verify the tag URL's CMAC server-side. `completion(true)` only on a valid,
    /// first-party tag. Network/parse failures resolve to `false` (fail closed).
    static func verify(_ url: URL, completion: @escaping (Bool) -> Void) {
        guard let host = url.host, AppConfig.allowedNavigationHosts.contains(host),
              let p = params(from: url),
              var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            completion(false); return
        }
        comps.path = "/api/v1/auth/sdm/verify"
        comps.query = nil
        comps.fragment = nil
        guard let endpoint = comps.url else { completion(false); return }

        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 12
        let payload: [String: Any] = ["uid": p.uid, "sdmmac": p.mac, "sdmcounter": p.ctr]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: req) { data, resp, _ in
            var ok = false
            if let http = resp as? HTTPURLResponse, http.statusCode == 200,
               let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                ok = (obj["ok"] as? Bool) == true
            }
            completion(ok)
        }.resume()
    }
}
