@testable import App
import XCTVapor

final class MemberTests: XCTestCase {
    func testCreateMemberReturnsCreated() async throws {
        try await withApp { app in
            try await app.test(.POST, "members", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille", email: "camille@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .created)
                XCTAssertEqual(try res.content.decode(MemberDTO.self).name, "Camille")
            })
        }
    }

    func testCreateMemberWithInvalidEmailIsRejected() async throws {
        try await withApp { app in
            try await app.test(.POST, "members", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille", email: "not-an-email"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }

    func testCreateMemberWithDuplicateEmailReturnsConflict() async throws {
        try await withApp { app in
            _ = try await createMember(app)

            try await app.test(.POST, "members", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Autre", email: "camille@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .conflict)
            })
        }
    }

    func testShowUnknownMemberReturnsNotFound() async throws {
        try await withApp { app in
            try await app.test(.GET, "members/\(UUID())", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .notFound)
            })
        }
    }

    // MARK: - PUT /members/:memberID

    func testUpdateMemberReplacesNameAndEmail() async throws {
        try await withApp { app in
            let member = try await createMember(app)
            let id = try XCTUnwrap(member.id)

            try await app.test(.PUT, "members/\(id)", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille D.", email: "camille.d@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                let updated = try res.content.decode(MemberDTO.self)
                XCTAssertEqual(updated.id, id)
                XCTAssertEqual(updated.name, "Camille D.")
                XCTAssertEqual(updated.email, "camille.d@example.com")
            })

            // The change is saved, not only sent back.
            try await app.test(.GET, "members/\(id)", afterResponse: { res async throws in
                XCTAssertEqual(try res.content.decode(MemberDTO.self).name, "Camille D.")
            })
        }
    }

    func testUpdateMemberKeepingOwnEmailIsNotAConflict() async throws {
        try await withApp { app in
            let member = try await createMember(app)

            try await app.test(.PUT, "members/\(try XCTUnwrap(member.id))", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille D.", email: "camille@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
        }
    }

    func testUpdateMemberWithAnotherMembersEmailReturnsConflict() async throws {
        try await withApp { app in
            _ = try await createMember(app, email: "camille@example.com")
            let alex = try await createMember(app, name: "Alex", email: "alex@example.com")

            try await app.test(.PUT, "members/\(try XCTUnwrap(alex.id))", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Alex", email: "camille@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .conflict)
            })
        }
    }

    func testUpdateMemberWithInvalidEmailIsRejected() async throws {
        try await withApp { app in
            let member = try await createMember(app)

            try await app.test(.PUT, "members/\(try XCTUnwrap(member.id))", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille", email: "not-an-email"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }

    func testUpdateUnknownMemberReturnsNotFound() async throws {
        try await withApp { app in
            try await app.test(.PUT, "members/\(UUID())", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille", email: "camille@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .notFound)
            })
        }
    }

    // MARK: - GET /members/:memberID/loans

    func testMemberLoansListsReturnedAndOngoingLoansOldestFirst() async throws {
        try await withApp { app in
            let catan = try await createGame(app, title: "Catan")
            let dixit = try await createGame(app, title: "Dixit")
            let member = try await createMember(app)
            let memberID = try XCTUnwrap(member.id)
            let now = Date()
            // Inserted newest first, to check that the API sorts them.
            try await insertLoan(
                app, gameID: try XCTUnwrap(dixit.id), memberID: memberID,
                borrowedAt: now.addingTimeInterval(-86_400), dueAt: now.addingTimeInterval(13 * 86_400)
            )
            try await insertLoan(
                app, gameID: try XCTUnwrap(catan.id), memberID: memberID,
                borrowedAt: now.addingTimeInterval(-20 * 86_400), dueAt: now.addingTimeInterval(-6 * 86_400),
                returnedAt: now.addingTimeInterval(-7 * 86_400)
            )

            try await app.test(.GET, "members/\(memberID)/loans", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                let loans = try res.content.decode([LoanDTO].self)
                XCTAssertEqual(loans.map(\.gameID), [catan.id, dixit.id])
                XCTAssertNotNil(loans[0].returnedAt)
                XCTAssertNil(loans[1].returnedAt)
            })
        }
    }

    func testMemberWithoutLoansGetsAnEmptyList() async throws {
        try await withApp { app in
            let member = try await createMember(app)

            try await app.test(.GET, "members/\(try XCTUnwrap(member.id))/loans", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                XCTAssertEqual(try res.content.decode([LoanDTO].self).count, 0)
            })
        }
    }

    func testLoansOfUnknownMemberReturnsNotFound() async throws {
        try await withApp { app in
            try await app.test(.GET, "members/\(UUID())/loans", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .notFound)
            })
        }
    }

    // MARK: - DELETE /members/:memberID

    func testDeleteMemberRemovesThem() async throws {
        try await withApp { app in
            let member = try await createMember(app)
            let id = try XCTUnwrap(member.id)

            try await app.test(.DELETE, "members/\(id)", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .noContent)
            })
            try await app.test(.GET, "members/\(id)", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .notFound)
            })
        }
    }

    func testDeleteUnknownMemberReturnsNotFound() async throws {
        try await withApp { app in
            try await app.test(.DELETE, "members/\(UUID())", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .notFound)
            })
        }
    }

    func testDeleteMemberWithReturnedLoanReturnsConflict() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)
            let id = try XCTUnwrap(member.id)
            let now = Date()
            // A returned loan: nothing is borrowed any more, but the history must be kept.
            try await insertLoan(
                app,
                gameID: try XCTUnwrap(game.id),
                memberID: id,
                borrowedAt: now.addingTimeInterval(-3 * 86_400),
                dueAt: now.addingTimeInterval(11 * 86_400),
                returnedAt: now
            )

            try await app.test(.DELETE, "members/\(id)", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .conflict)
            })
            try await app.test(.GET, "members/\(id)", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
        }
    }

    func testDeleteMemberWithMalformedIDReturnsBadRequest() async throws {
        try await withApp { app in
            try await app.test(.DELETE, "members/not-a-uuid", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }

    func testUpdateMemberWithMalformedIDReturnsBadRequest() async throws {
        try await withApp { app in
            try await app.test(.PUT, "members/not-a-uuid", beforeRequest: { req in
                try req.content.encode(CreateMemberDTO(name: "Camille", email: "camille@example.com"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }
}
