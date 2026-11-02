// gomx_sso.go
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

package main

// Single sign-on (m.login.sso, e.g. SAML, OpenID Connect or CAS behind the
// homeserver): the user signs in in the browser at the homeserver's SSO
// page, which redirects to a one-off HTTP listener on 127.0.0.1 with a
// login token; the token is then exchanged for a session (m.login.token).

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"maunium.net/go/mautrix"
)

type ssoState struct {
	server *http.Server
	tokens chan string
}

var (
	ssoMu     sync.Mutex
	ssoStates = map[int]*ssoState{}
)

// MxLoginFlows lists the login types the homeserver offers that braids
// supports, space separated ("password", "sso"); empty when unknown.
func MxLoginFlows(homeserver string) string {
	client, err := mautrix.NewClient(homeserver, "", "")
	if err != nil {
		return ""
	}
	client.Log = newLogger()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	flows, err := client.GetLoginFlows(ctx)
	if err != nil {
		LOG_DEBUG(fmt.Sprintf("login flows lookup failed: %v", err))
		return ""
	}

	var types []string
	if flows.HasFlow(mautrix.AuthTypePassword) {
		types = append(types, "password")
	}
	if flows.HasFlow(mautrix.AuthTypeSSO) && flows.HasFlow(mautrix.AuthTypeToken) {
		types = append(types, "sso")
	}
	return strings.Join(types, " ")
}

// MxSsoStart starts the local listener and returns the URL to open in the
// browser (empty on failure).
func MxSsoStart(connId int, homeserver string) string {
	MxSsoStop(connId)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		LOG_WARNING(fmt.Sprintf("sso listener failed: %v", err))
		return ""
	}

	state := &ssoState{tokens: make(chan string, 1)}
	mux := http.NewServeMux()
	mux.HandleFunc("/sso", func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("loginToken")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if token == "" {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, ssoPage("Sign-in did not complete", "Go back to braids and try again."))
			return
		}
		select {
		case state.tokens <- token:
		default:
		}
		fmt.Fprint(w, ssoPage("Signed in", "You can close this tab and go back to braids."))
	})
	state.server = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = state.server.Serve(listener) }()

	ssoMu.Lock()
	ssoStates[connId] = state
	ssoMu.Unlock()

	redirect := fmt.Sprintf("http://%s/sso", listener.Addr().String())
	return strings.TrimRight(homeserver, "/") + "/_matrix/client/v3/login/sso/redirect?redirectUrl=" + url.QueryEscape(redirect)
}

// MxSsoWait waits up to timeoutMs for the login token ("" when none came).
func MxSsoWait(connId int, timeoutMs int) string {
	ssoMu.Lock()
	state := ssoStates[connId]
	ssoMu.Unlock()
	if state == nil {
		return ""
	}

	select {
	case token := <-state.tokens:
		return token
	case <-time.After(time.Duration(timeoutMs) * time.Millisecond):
		return ""
	}
}

// MxSsoStop closes the local listener.
func MxSsoStop(connId int) {
	ssoMu.Lock()
	state := ssoStates[connId]
	delete(ssoStates, connId)
	ssoMu.Unlock()
	if state != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = state.server.Shutdown(ctx)
	}
}

func ssoPage(title string, text string) string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>braids</title>` +
		`<style>body{font-family:system-ui,sans-serif;background:#faf9f7;color:#1c1917;display:flex;` +
		`align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}` +
		`h1{font-size:22px;margin:0 0 8px}p{color:#6b655f;margin:0}` +
		`@media(prefers-color-scheme:dark){body{background:#151311;color:#f2efeb}p{color:#a39b93}}</style>` +
		`</head><body><div><h1>` + title + `</h1><p>` + text + `</p></div></body></html>`
}
