import {bindable, autoinject, computedFrom} from "aurelia-framework";
import {Router} from "aurelia-router";
import {Authentication} from "../ctrls/authentication";
import appCfg from '../app-config';
import {log} from '../logger';

@autoinject()
export class NavBar {
	@bindable router: Router;

	private profileName:string = "Profile";
	private profileUrl:string = "";

	constructor(private auth: Authentication) {
		this.auth.onProfileChanged.sub((sender, profile) => {
			if (profile != null) {
				this.profileName = "Logged as " + profile.name;
				this.profileUrl = appCfg.storage.baseUrl + appCfg.storage.avatar + profile.avatar;
			} else {
				this.profileName = "Profile";
				this.profileUrl = `images/avatar.svg`;
			}
		});
	}

	created() {
		if (this.auth.isAuthenticated) {
			let profile = this.auth.getProfile();
			if (profile != null) {
				this.profileName = "Logged as " + profile.name;
				this.profileUrl = appCfg.storage.baseUrl + appCfg.storage.avatar + profile.avatar;
			} else {
				this.profileName = "Profile";
				this.profileUrl = `images/avatar.svg`;
			}
		}
	}

	@computedFrom('auth.isAuthenticated')
  	get isAuthenticated() {
		return this.auth.isAuthenticated;
	}
}
