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
    func testManualAddress() {
        XCTAssertEqual(PairingTarget.server(from: "192.168.1.20")?.absoluteString, "http://192.168.1.20:8787")
        XCTAssertEqual(PairingTarget.server(from: "nas.local:9000/")?.absoluteString, "http://nas.local:9000")
        XCTAssertEqual(PairingTarget.server(from: "https://x.ts.net")?.absoluteString, "https://x.ts.net")
        XCTAssertNil(PairingTarget.server(from: "  "))
    }
}
