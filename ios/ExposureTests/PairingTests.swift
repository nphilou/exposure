import XCTest
@testable import Exposure

final class PairingTests: XCTestCase {
    func testParsesQR() {
        let t = PairingTarget.parse(qr: "http://192.168.1.20:8787/pair?code=KY8FGVAU")
        XCTAssertEqual(t?.server.absoluteString, "http://192.168.1.20:8787")
        XCTAssertEqual(t?.code, "KY8FGVAU")
    }
    func testParsesHTTPSWithoutPortAndDashedCode() {
        let t = PairingTarget.parse(qr: "https://exposure.tail1234.ts.net/pair?code=ky8f-gvau")
        XCTAssertEqual(t?.server.absoluteString, "https://exposure.tail1234.ts.net")
        XCTAssertEqual(t?.code, "KY8FGVAU")
    }
    func testRejectsOtherQRs() {
        XCTAssertNil(PairingTarget.parse(qr: "WIFI:S:home;T:WPA;P:secret;;"))
        XCTAssertNil(PairingTarget.parse(qr: "https://example.com/pair"))
    }
    func testParsesAppLink() {
        let t = PairingTarget.parse(qr: "exposure://pair?server=http%3A%2F%2F192.168.1.20%3A8787&code=KY8F-GVAU")
        XCTAssertEqual(t?.server.absoluteString, "http://192.168.1.20:8787")
        XCTAssertEqual(t?.code, "KY8FGVAU")
        XCTAssertEqual(t?.serverLabel, "192.168.1.20:8787")
        // Unencoded server value, as a hand-typed simctl openurl would send it.
        XCTAssertEqual(PairingTarget.parse(qr: "exposure://pair?server=https://x.ts.net&code=KY8FGVAU")?.server.absoluteString, "https://x.ts.net")
    }
    func testRejectsBadAppLinks() {
        XCTAssertNil(PairingTarget.parse(qr: "exposure://pair?code=KY8FGVAU"))                              // no server
        XCTAssertNil(PairingTarget.parse(qr: "exposure://pair?server=ftp://nas&code=KY8FGVAU"))             // not http(s)
        XCTAssertNil(PairingTarget.parse(qr: "exposure://open?server=http://nas:8787&code=KY8FGVAU"))       // other action
    }
    func testManualAddress() {
        XCTAssertEqual(PairingTarget.server(from: "192.168.1.20")?.absoluteString, "http://192.168.1.20:8787")
        XCTAssertEqual(PairingTarget.server(from: "nas.local:9000/")?.absoluteString, "http://nas.local:9000")
        XCTAssertEqual(PairingTarget.server(from: "https://x.ts.net")?.absoluteString, "https://x.ts.net")
        XCTAssertNil(PairingTarget.server(from: "  "))
    }
}
