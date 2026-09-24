import SwiftUI

struct SearchView: View {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    @State private var q = ""
    @State private var suggestions: [Suggestion] = []
    @State private var feed = PhotoFeed()
    @State private var searched = ""
    @FocusState private var focused: Bool

    private var trimmed: String { q.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(Theme.tx2)
                    TextField("Shoots, cameras, dates", text: $q)
                        .font(.geist(16)).focused($focused).submitLabel(.search)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    if !q.isEmpty {
                        Button { q = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.tx3) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12).frame(height: 42)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.hover))
                Button("Cancel") { withAnimation(.easeOut(duration: 0.2)) { router.searching = false } }
                    .font(.geist(15)).buttonStyle(.plain)
            }
            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 10)

            ScrollView {
                if trimmed.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Try").font(.geist(12)).foregroundStyle(Theme.tx3).padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 4)
                        ForEach(suggestions, id: \.self) { s in
                            Button { q = s.label } label: {
                                HStack {
                                    Text(s.label).font(.geist(16))
                                    Spacer()
                                    Text(s.kind).font(.geist(13)).foregroundStyle(Theme.tx3)
                                }
                                .padding(.horizontal, 18).padding(.vertical, 13)
                                .overlay(alignment: .bottom) { Theme.line.frame(height: 1) }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else if feed.loaded && searched == trimmed && feed.photos.isEmpty {
                    Text("Nothing matches “\(trimmed)”.").font(.geist(15)).foregroundStyle(Theme.tx2)
                        .frame(maxWidth: .infinity).padding(.vertical, 48).padding(.horizontal, 18)
                } else if !feed.photos.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(Fmt.photos(feed.photos.count)).font(.geist(12)).foregroundStyle(Theme.tx3)
                            .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 8)
                        PhotoGrid(sections: [PhotoSection(id: "search", title: "", sub: "", photos: feed.photos)], showHeaders: false) {
                            Task { await feed.loadMore(store: store) }
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .padding(.bottom, 0)
        }
        .foregroundStyle(Theme.tx)
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { focused = true }
        .task { suggestions = (try? await store.call { try await $0.suggestions() }) ?? [] }
        .task(id: trimmed) {
            guard !trimmed.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(250))     // debounce typing
            guard !Task.isCancelled else { return }
            var query = APIClient.PhotoQuery(); query.q = trimmed
            await feed.load(query, store: store)
            searched = trimmed
        }
    }
}
