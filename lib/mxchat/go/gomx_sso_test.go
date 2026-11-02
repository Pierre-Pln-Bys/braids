// gomx_sso_test.go
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// a homeserver with single sign-on only: the redirect endpoint sends the
// browser back to the client's redirectUrl with a login token
func TestSsoLoginToken(t *testing.T) {
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/_matrix/client/v3/login":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"flows":[{"type":"m.login.sso"},{"type":"m.login.token"}]}`))
		case "/_matrix/client/v3/login/sso/redirect":
			back, err := url.Parse(r.URL.Query().Get("redirectUrl"))
			if err != nil || back.Hostname() != "127.0.0.1" {
				http.Error(w, "bad redirect", http.StatusBadRequest)
				return
			}
			q := back.Query()
			q.Set("loginToken", "token-123")
			back.RawQuery = q.Encode()
			http.Redirect(w, r, back.String(), http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer hs.Close()

	if flows := MxLoginFlows(hs.URL); flows != "sso" {
		t.Fatalf("flows %q, want sso", flows)
	}

	start := MxSsoStart(42, hs.URL)
	if start == "" {
		t.Fatal("no sign-in URL")
	}
	defer MxSsoStop(42)

	// the browser: follows the homeserver's redirect to the local listener
	resp, err := http.Get(start)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("callback status %d", resp.StatusCode)
	}

	if token := MxSsoWait(42, 2000); token != "token-123" {
		t.Fatalf("token %q", token)
	}
	if token := MxSsoWait(42, 100); token != "" {
		t.Fatalf("second token %q", token)
	}
}

func TestListBullets(t *testing.T) {
	got := listBullets.ReplaceAllString("intro\n* one\n  * two\n*bold* text", "$1- ")
	if want := "intro\n- one\n  - two\n*bold* text"; got != want {
		t.Fatalf("got %q", got)
	}
}
